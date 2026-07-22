import crypto from 'crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { AppConfig } from '../config/index.js';
import { handleIncomingMessage } from '../whatsapp/auto-reply.js';

/** Options passed when registering this plugin. */
export interface SessionRoutesOptions extends FastifyPluginOptions {
  config: AppConfig;
}

/** Timeout (ms) before the QR SSE stream closes automatically. */
const QR_STREAM_TIMEOUT_MS = 60_000;

/**
 * Builds the HMAC-SHA256 signature used to authenticate webhook callbacks
 * sent from the gateway to the Supabase Edge Function.
 *
 * Header: `X-Gateway-Signature: sha256=<hex>`
 */
function buildHmacSignature(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Posts a session-status update to the configured Supabase webhook URL.
 * Fire-and-forget: errors are logged but do not throw.
 */
async function notifyWebhook(
  webhookUrl: string,
  hmacSecret: string,
  supabaseAnonKey: string,
  payload: {
    session_id: string;
    status: string;
    phone_number?: string | null;
    display_name?: string | null;
  }
): Promise<void> {
  try {
    const body = JSON.stringify(payload);
    const signature = buildHmacSignature(hmacSecret, body);

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Signature': signature,
        // Supabase Edge Functions require either anon key or service role key
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(
        `[SessionRoutes] Webhook responded ${res.status} for session ${payload.session_id}: ${errText}`
      );
    }
  } catch (err) {
    console.error('[SessionRoutes] Failed to notify webhook:', err);
  }
}

/**
 * WhatsApp session management routes.
 *
 * GET  /sessions             — list all active sessions
 * GET  /sessions/:id/qr      — stream QR code via SSE until connected or timeout
 * POST /sessions/:id/disconnect — disconnect a session
 */
export async function sessionRoutes(
  app: FastifyInstance,
  options: SessionRoutesOptions
): Promise<void> {
  const { config } = options;
  const { gatewayWebhookUrl, webhookHmacSecret } = config;
  const supabaseAnonKey = config.supabase.anonKey;

  // Helper to call notifyWebhook with config baked in
  const notify = (payload: {
    session_id: string;
    status: string;
    phone_number?: string | null;
    display_name?: string | null;
  }) => notifyWebhook(gatewayWebhookUrl, webhookHmacSecret, supabaseAnonKey, payload);

  // ── Shared onMessage handler (always active, survives SSE overrides) ─────────
  const sharedOnMessage = async (sessionId: string, event: unknown) => {
    const { messages, type } = event as { messages: { key: { fromMe?: boolean; remoteJid?: string; id?: string }; message?: unknown; messageTimestamp?: number | { low?: number } }[]; type: string };
    // Accept both 'notify' (new messages) and 'append' (can be new in some Baileys configs)
    if (type !== 'notify' && type !== 'append') return;

    const nowSec = Math.floor(Date.now() / 1000);
    const fiveMinutesAgo = nowSec - 300; // only process messages from last 5 minutes

    for (const msg of messages ?? []) {
      const rawJidAll = msg.key.remoteJid ?? '';
      console.log(`[MSG-IN] type=${type} fromMe=${msg.key.fromMe} jid="${rawJidAll}"`);
      if (msg.key.fromMe) continue;
      const rawJid = msg.key.remoteJid ?? '';
      if (!rawJid) continue;

      // For 'append' type, only process if message is recent (not old history)
      if (type === 'append') {
        const ts = typeof msg.messageTimestamp === 'object'
          ? (msg.messageTimestamp?.low ?? 0)
          : (msg.messageTimestamp ?? 0);
        if (ts < fiveMinutesAgo) continue; // skip old history messages
      }

      // Skip groups and broadcasts only — handle @lid by resolving to phone number
      if (rawJid.endsWith('@g.us') || rawJid.endsWith('@broadcast')) continue;

      let from: string;
      if (rawJid.endsWith('@lid')) {
        // Resolve @lid to phone number using lidMap built from contacts events
        const sessionInfo2 = app.sessionManager.getSession(sessionId);
        const phone = sessionInfo2?.lidMap.get(rawJid);
        if (phone) {
          from = `${phone}@s.whatsapp.net`;
        } else {
          // Try to resolve via WA API
          try {
            const lid = rawJid.replace('@lid', '');
            const results = await sessionInfo2?.socket.onWhatsApp(lid) ?? [];
            const resolved = results.find(r => r.exists && r.jid?.endsWith('@s.whatsapp.net'));
            if (resolved?.jid) {
              from = resolved.jid.replace(/:\d+@/, '@');
              // Cache for future
              if (sessionInfo2) sessionInfo2.lidMap.set(rawJid, from.split('@')[0] ?? '');
              console.log(`[LID] Resolved via onWhatsApp: ${rawJid} → ${from}`);
            } else {
              console.log(`[LID] Cannot resolve ${rawJid} via onWhatsApp`);
              continue;
            }
          } catch (err) {
            console.log(`[LID] onWhatsApp error for ${rawJid}:`, err);
            continue;
          }
        }
      } else {
        // Normalize JID: strip device suffix "number:deviceId@domain" → "number@domain"
        from = rawJid.includes(':') && rawJid.endsWith('@s.whatsapp.net')
          ? rawJid.replace(/:\d+@/, '@')
          : rawJid;
      }

      const text = (msg as { message?: { conversation?: string; extendedTextMessage?: { text?: string } } }).message?.conversation
        ?? (msg as { message?: { conversation?: string; extendedTextMessage?: { text?: string } } }).message?.extendedTextMessage?.text
        ?? '';
      const sessionInfo = app.sessionManager.getSession(sessionId);
      if (!sessionInfo) continue;

      // Pass sessionDbId (UUID from wa_sessions) and rawMessage for chat_messages save
      void handleIncomingMessage(
        { url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey },
        config.gatewayWebhookUrl, config.gatewayApiKey, sessionId, from, text,
        async (to: string, message: string) => {
          const jid = `${to}@s.whatsapp.net`;
          await sessionInfo.socket.sendMessage(jid, { text: message });
        },
        sessionInfo.dbId,
        msg
      );
    }
  };

  // ── Shared base handlers (status + message) ───────────────────────────────
  const baseHandlers = () => ({
    onStatusChange: (sessionId: string, status: string) => {
      const session = app.sessionManager.getSession(sessionId);
      void notify({ session_id: sessionId, status, phone_number: session?.phoneNumber ?? null, display_name: session?.displayName ?? null });
    },
    onMessage: sharedOnMessage,
  });

  // ── Wire up session-manager event handlers ────────────────────────────────
  app.sessionManager.setEventHandlers({
    ...baseHandlers(),
  });

  // ── GET /sessions ────────────────────────────────────────────────────────────
  app.get('/', async (_request, reply) => {
    const sessions = app.sessionManager.getSessions();
    return reply.send({ sessions });
  });

  // ── GET /sessions/:id/qr — SSE stream ────────────────────────────────────────
  //
  // The client keeps the connection open.  The gateway pushes events:
  //
  //   event: qr
  //   data: {"session_id":"...","qr":"<base64>"}
  //
  //   event: status
  //   data: {"session_id":"...","status":"connected"|"disconnected"|"pairing"|"expired"}
  //
  //   event: done
  //   data: {"session_id":"...","status":"connected"}
  //
  // The stream closes automatically after 60 s or when the session connects.
  // Query param: dbId — the Supabase UUID for this session (used for contact sync)
  app.get<{ Params: { id: string }; Querystring: { dbId?: string } }>('/:id/qr', async (request, reply) => {
    const { id } = request.params;
    const { dbId } = request.query;

    // Set SSE headers — send raw reply without Fastify serialisation
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering if behind a proxy
    });

    // Helper to write a named SSE event
    const sendEvent = (event: string, data: object): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Ensure session exists (creates it if necessary)
    let session = app.sessionManager.getSession(id);
    if (!session) {
      session = await app.sessionManager.createSession(id, dbId);
    } else if (dbId && !session.dbId) {
      // Attach DB UUID if it wasn't set during restore
      session.dbId = dbId;
    }

    // If already connected, send one status event and close immediately
    if (session.status === 'connected') {
      sendEvent('status', { session_id: id, status: 'connected' });
      sendEvent('done', { session_id: id, status: 'connected' });
      res.end();
      return;
    }

    // If there's already a QR code queued, send it right away
    const existingQr = app.sessionManager.getQrCode(id);
    if (existingQr) {
      sendEvent('qr', { session_id: id, qr: existingQr });
    }

    let finished = false;

    const finish = (status: string): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);
      // Restore global handlers
      app.sessionManager.setEventHandlers({ ...baseHandlers() });
      sendEvent('done', { session_id: id, status });
      res.end();
    };

    // Override event handlers for the duration of this SSE connection
    app.sessionManager.setEventHandlers({
      ...baseHandlers(),
      onStatusChange: (sessionId, status) => {
        const s = app.sessionManager.getSession(sessionId);
        void notify({ session_id: sessionId, status, phone_number: s?.phoneNumber ?? null, display_name: s?.displayName ?? null });
        if (sessionId !== id) return;
        sendEvent('status', { session_id: id, status });
        if (status === 'connected') finish('connected');
        else if (status === 'disconnected') finish('disconnected');
      },
      onQrCode: (sessionId, qr) => {
        if (sessionId !== id) return;
        sendEvent('qr', { session_id: id, qr });
      },
    });

    const timeoutHandle = setTimeout(() => {
      if (!finished) {
        finished = true;
        sendEvent('done', { session_id: id, status: 'timeout' });
        res.end();
        app.sessionManager.setEventHandlers({ ...baseHandlers() });
      }
    }, QR_STREAM_TIMEOUT_MS);

    request.socket.on('close', () => {
      if (!finished) {
        finished = true;
        clearTimeout(timeoutHandle);
        app.sessionManager.setEventHandlers({ ...baseHandlers() });
      }
    });
  });

  // ── POST /sessions/:id/disconnect ────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/disconnect', async (request, reply) => {
    const { id } = request.params;

    const session = app.sessionManager.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: 'Not Found', message: `Session '${id}' not found` });
    }

    await app.sessionManager.disconnectSession(id);

    return reply.send({ session_id: id, status: 'disconnected' });
  });

  // ── DELETE /sessions/:id — permanently delete session + disk files ───────────
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { permanent } = request.query as { permanent?: string };
    // permanent=false → disconnect only (clear memory+disk but allow reconnect)
    // permanent=true (default) → add to deletedSessions to prevent reconnect
    await app.sessionManager.deleteSession(id, permanent !== 'false');
    return reply.send({ session_id: id, deleted: true });
  });
}
