import path from 'path';
import fs from 'fs/promises';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import type { SessionStatus, WaSession } from '../types/index.js';
import { watchContactsUpsert } from './contact-sync.js';

export interface SessionInfo {
  id: string;
  dbId?: string; // UUID from Supabase wa_sessions table
  socket: WASocket;
  status: SessionStatus;
  qrCode?: string;
  phoneNumber?: string;
  displayName?: string;
  lastActiveAt?: Date;
  reconnectAttempts: number;
}

export type SessionEventHandler = {
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
  onQrCode?: (sessionId: string, qr: string) => void;
  onMessage?: (sessionId: string, message: unknown) => void;
  onConnected?: (sessionId: string, socket: WASocket) => void;
};

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3000;

/**
 * Manages multiple WhatsApp sessions using Baileys.
 * Each session is stored persistently in the configured directory.
 */
export class SessionManager {
  private sessions = new Map<string, SessionInfo>();
  private deletedSessions = new Set<string>(); // tracks permanently deleted sessions
  private sessionStorePath: string;
  private eventHandlers: SessionEventHandler = {};
  private supabaseConfig?: { url: string; serviceRoleKey: string };

  constructor(sessionStorePath: string, supabaseConfig?: { url: string; serviceRoleKey: string }) {
    this.sessionStorePath = sessionStorePath;
    this.supabaseConfig = supabaseConfig;
  }

  setEventHandlers(handlers: SessionEventHandler): void {
    this.eventHandlers = handlers;
  }

  /** Wraps onStatusChange to skip deleted sessions */
  private notifyStatus(sessionId: string, status: SessionStatus): void {
    if (this.deletedSessions.has(sessionId)) return;
    this.eventHandlers.onStatusChange?.(sessionId, status);
  }

  /**
   * Initializes the session store directory and restores any persisted sessions.
   * Also starts a background interval to detect sessions deleted from DB while running.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionStorePath, { recursive: true });
    // Restore existing sessions on startup
    await this.restorePersistedSessions();
    // Periodically sync with DB to clean up sessions deleted while gateway is running
    this.startDbSyncInterval();
  }

  /**
   * Polls DB every 30 seconds to remove sessions that were deleted from DB
   * while the gateway was already running.
   */
  private startDbSyncInterval(): void {
    if (!this.supabaseConfig) return;

    setInterval(async () => {
      try {
        const res = await fetch(
          `${this.supabaseConfig!.url}/rest/v1/wa_sessions?select=id,session_key`,
          {
            headers: {
              apikey: this.supabaseConfig!.serviceRoleKey,
              Authorization: `Bearer ${this.supabaseConfig!.serviceRoleKey}`,
            },
          }
        );
        if (!res.ok) return;

        const rows = await res.json() as { id: string; session_key: string }[];
        const sessionMap = new Map(rows.map((r) => [r.session_key, r.id]));

        // Find sessions in memory that no longer exist in DB
        for (const [sessionKey, info] of this.sessions) {
          if (!sessionMap.has(sessionKey)) {
            console.info(`[SessionManager] Session '${sessionKey}' deleted from DB — removing from memory and disk`);
            await this.deleteSession(sessionKey);
          } else if (!info.dbId) {
            // Attach dbId if it was missing (e.g. session restored without dbId)
            info.dbId = sessionMap.get(sessionKey);
          }
        }

        // Also clean up orphaned disk directories
        const entries = await fs.readdir(this.sessionStorePath, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (!sessionMap.has(entry.name) && !this.sessions.has(entry.name)) {
            const dir = path.join(this.sessionStorePath, entry.name);
            console.info(`[SessionManager] Removing orphaned directory: ${entry.name}`);
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[SessionManager] DB sync interval error:', err);
      }
    }, 30_000); // every 30 seconds
  }

  /**
   * Creates a new WhatsApp session or reconnects to an existing one.
   * @param sessionId The session_key (gateway identifier)
   * @param dbId Optional UUID from Supabase wa_sessions table — used for contact sync tracking
   */
  async createSession(sessionId: string, dbId?: string): Promise<SessionInfo> {
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!;
      // Update dbId if provided and not already set
      if (dbId && !existing.dbId) existing.dbId = dbId;
      return existing;
    }

    return this.connectSession(sessionId, 0, dbId);
  }

  /**
   * Gets all active sessions as a list of WaSession DTOs.
   */
  getSessions(): WaSession[] {
    return Array.from(this.sessions.values()).map((info) => ({
      id: info.id,
      session_key: info.id,
      phone_number: info.phoneNumber,
      display_name: info.displayName,
      status: info.status,
      last_active_at: info.lastActiveAt?.toISOString(),
    }));
  }

  /**
   * Gets a specific session by ID.
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Disconnects a session (keeps session files on disk for reconnect).
   */
  async disconnectSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        await session.socket.logout();
      } catch {
        // Ignore errors during logout — socket may already be closed
      }
      this.sessions.delete(sessionId);
    }

    this.notifyStatus(sessionId, 'disconnected');
  }

  /**
   * Permanently deletes a session: closes socket, removes from memory,
   * and deletes all persisted session files from disk.
   * Pass keepInDeleted=false to allow re-creating the session afterwards.
   */
  async deleteSession(sessionId: string, keepInDeleted = true): Promise<void> {
    // Mark as deleted BEFORE closing socket to prevent reconnect logic
    if (keepInDeleted) {
      this.deletedSessions.add(sessionId);
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.socket.ev.removeAllListeners();
        await session.socket.logout();
      } catch {
        // Ignore errors during logout — socket may already be closed
      }
      this.sessions.delete(sessionId);
    }

    // Delete persisted session files from disk
    try {
      const sessionDir = path.join(this.sessionStorePath, sessionId);
      await fs.rm(sessionDir, { recursive: true, force: true });
      console.info(`[SessionManager] Deleted session directory: ${sessionId}`);
    } catch {
      // Ignore if directory doesn't exist
    }
  }

  /**
   * Gets the current QR code for a pairing session.
   */
  getQrCode(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.qrCode;
  }

  private async connectSession(sessionId: string, reconnectAttempts: number, dbId?: string): Promise<SessionInfo> {
    const sessionDir = path.join(this.sessionStorePath, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const socket = makeWASocket({
      auth: state,
      logger: {
        level: 'silent',
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child: () => ({ level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => ({} as any) }),
      } as any,
      markOnlineOnConnect: false,
      syncFullHistory: true,  // needed to receive contacts.set with full contact list
    });

    const sessionInfo: SessionInfo = {
      id: sessionId,
      dbId,
      socket,
      status: 'pairing',
      reconnectAttempts,
    };

    this.sessions.set(sessionId, sessionInfo);

    // Persist credentials on update
    socket.ev.on('creds.update', saveCreds);

    // Handle connection state changes
    socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      await this.handleConnectionUpdate(sessionId, update, saveCreds);
    });

    // Handle incoming messages (for auto-reply, forwarded via webhook)
    socket.ev.on('messages.upsert', (event) => {
      this.eventHandlers.onMessage?.(sessionId, event);
    });

    // Sync contacts when WA sends them after connection
    // Pass dbId so contacts are linked to this session's DB record
    if (this.supabaseConfig) {
      const resolvedDbId = dbId ?? sessionId; // fallback to session_key if no DB UUID
      watchContactsUpsert(socket, this.supabaseConfig, resolvedDbId);
    }

    return sessionInfo;
  }

  private async handleConnectionUpdate(
    sessionId: string,
    update: Partial<ConnectionState>,
    saveCreds: () => Promise<void>
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const { connection, lastDisconnect, qr, isNewLogin } = update;

    if (qr) {
      session.qrCode = qr;
      session.status = 'pairing';
      this.eventHandlers.onQrCode?.(sessionId, qr);
      this.notifyStatus(sessionId, 'pairing');
    }

    if (isNewLogin) {
      await saveCreds();
    }

    if (connection === 'open') {
      session.status = 'connected';
      session.qrCode = undefined;
      session.reconnectAttempts = 0;
      session.lastActiveAt = new Date();

      // Extract phone number and display name from socket user info
      const user = session.socket.user;
      if (user) {
        session.phoneNumber = user.id?.split(':')[0];
        session.displayName = user.name;
      }

      this.notifyStatus(sessionId, 'connected');
      this.eventHandlers.onConnected?.(sessionId, session.socket);

      // Trigger initial contact sync from socket.store (if available)
      // contacts.upsert event may come later with more contacts
      if (this.supabaseConfig && session.dbId) {
        const { syncContacts } = await import('./contact-sync.js');
        void syncContacts(session.socket, this.supabaseConfig, session.dbId);
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      session.status = 'disconnected';
      this.notifyStatus(sessionId, 'disconnected');

      // Don't reconnect if session was permanently deleted
      if (this.deletedSessions.has(sessionId)) {
        this.sessions.delete(sessionId);
        return;
      }

      if (shouldReconnect && session.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_DELAY_MS * Math.pow(2, session.reconnectAttempts);
        session.reconnectAttempts += 1;
        const savedDbId = session.dbId;

        setTimeout(async () => {
          // Only reconnect if session still exists (not manually disconnected)
          if (this.sessions.has(sessionId)) {
            this.sessions.delete(sessionId);
            await this.connectSession(sessionId, session.reconnectAttempts, savedDbId);
          }
        }, delay);
      } else if (!shouldReconnect) {
        // Logged out — clean up session files
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Restores previously persisted sessions from disk on startup.
   * Only restores sessions that still exist in the Supabase DB.
   * Orphaned session directories (deleted from DB) are removed from disk.
   */
  private async restorePersistedSessions(): Promise<void> {
    try {
      const entries = await fs.readdir(this.sessionStorePath, { withFileTypes: true });
      const sessionDirs = entries.filter((e) => e.isDirectory());

      if (!sessionDirs.length) return;

      // Fetch all valid sessions from Supabase DB (key + UUID) with retry
      let sessionMap: Map<string, string> = new Map(); // session_key → id (UUID)
      if (this.supabaseConfig) {
        let fetched = false;
        for (let attempt = 0; attempt < 3 && !fetched; attempt++) {
          try {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
            const res = await fetch(
              `${this.supabaseConfig.url}/rest/v1/wa_sessions?select=id,session_key`,
              {
                headers: {
                  apikey: this.supabaseConfig.serviceRoleKey,
                  Authorization: `Bearer ${this.supabaseConfig.serviceRoleKey}`,
                },
              }
            );
            if (res.ok) {
              const rows = await res.json() as { id: string; session_key: string }[];
              sessionMap = new Map(rows.map((r) => [r.session_key, r.id]));
              fetched = true;
              console.info(`[SessionManager] Fetched ${rows.length} sessions from DB`);
            }
          } catch (err) {
            console.warn(`[SessionManager] DB fetch attempt ${attempt + 1} failed:`, (err as Error).message);
          }
        }
        if (!fetched) {
          console.warn('[SessionManager] Could not fetch sessions from DB after retries, restoring all local sessions without dbId');
          // Restore all local sessions — dbId will be resolved lazily on first message
          sessionMap = new Map(sessionDirs.map((d) => [d.name, '__PENDING__']));
        }
      } else {
        sessionMap = new Map(sessionDirs.map((d) => [d.name, '']));
      }

      for (const dir of sessionDirs) {
        const sessionId = dir.name;
        const sessionDir = path.join(this.sessionStorePath, sessionId);
        const credsPath = path.join(sessionDir, 'creds.json');

        try {
          await fs.access(credsPath);
        } catch {
          continue;
        }

        if (!sessionMap.has(sessionId)) {
          console.info(`[SessionManager] Removing orphaned session directory: ${sessionId}`);
          await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
          continue;
        }

        // Pass dbId (UUID) so contact sync and chat messages are linked correctly
        // '__PENDING__' means DB was unreachable at startup — dbId will be resolved lazily
        const rawDbId = sessionMap.get(sessionId);
        const dbId = (rawDbId && rawDbId !== '__PENDING__') ? rawDbId : undefined;
        await this.connectSession(sessionId, 0, dbId);
      }
    } catch {
      // Session store dir doesn't exist yet — fine
    }
  }
}
