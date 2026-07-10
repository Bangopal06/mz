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

  /**
   * Initializes the session store directory and restores any persisted sessions.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionStorePath, { recursive: true });
    // Restore existing sessions on startup
    await this.restorePersistedSessions();
  }

  /**
   * Creates a new WhatsApp session or reconnects to an existing one.
   */
  async createSession(sessionId: string): Promise<SessionInfo> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    return this.connectSession(sessionId, 0);
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
   * Disconnects and removes a session, also deletes persisted files.
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

    // Delete persisted session files from disk
    try {
      const sessionDir = path.join(this.sessionStorePath, sessionId);
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }

    this.eventHandlers.onStatusChange?.(sessionId, 'disconnected');
  }

  /**
   * Gets the current QR code for a pairing session.
   */
  getQrCode(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.qrCode;
  }

  private async connectSession(sessionId: string, reconnectAttempts: number): Promise<SessionInfo> {
    const sessionDir = path.join(this.sessionStorePath, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const socket = makeWASocket({
      auth: state,
      // Suppress QR printing to terminal since we handle it via SSE
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
      syncFullHistory: false,
    });

    const sessionInfo: SessionInfo = {
      id: sessionId,
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
    if (this.supabaseConfig) {
      watchContactsUpsert(socket, this.supabaseConfig);
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
      this.eventHandlers.onStatusChange?.(sessionId, 'pairing');
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

      this.eventHandlers.onStatusChange?.(sessionId, 'connected');
      this.eventHandlers.onConnected?.(sessionId, session.socket);
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      session.status = 'disconnected';
      this.eventHandlers.onStatusChange?.(sessionId, 'disconnected');

      if (shouldReconnect && session.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_DELAY_MS * Math.pow(2, session.reconnectAttempts);
        session.reconnectAttempts += 1;

        setTimeout(async () => {
          // Only reconnect if session still exists (not manually disconnected)
          if (this.sessions.has(sessionId)) {
            this.sessions.delete(sessionId);
            await this.connectSession(sessionId, session.reconnectAttempts);
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
   */
  private async restorePersistedSessions(): Promise<void> {
    try {
      const entries = await fs.readdir(this.sessionStorePath, { withFileTypes: true });
      const sessionDirs = entries.filter((e) => e.isDirectory());

      for (const dir of sessionDirs) {
        const sessionId = dir.name;
        // Check if session has auth state (creds file exists)
        const credsPath = path.join(this.sessionStorePath, sessionId, 'creds.json');
        try {
          await fs.access(credsPath);
          // Session credentials exist — attempt to reconnect
          await this.connectSession(sessionId, 0);
        } catch {
          // No creds file — skip
        }
      }
    } catch {
      // Session store dir doesn't exist yet — fine
    }
  }
}
