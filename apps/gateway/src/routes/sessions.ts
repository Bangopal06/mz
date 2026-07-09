import crypto from 'crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { AppConfig } from '../config/index.js';

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
      },
      body,
    });

    if (!res.ok) {
      console.warn(
        `[SessionRoutes] Webhook responded ${res.status} for session ${payload.session_id}`
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

  // ── Wire up session-manager event handlers so every status change is
  //    forwarded to Supabase via the webhook callback. ─────────────────────────
  app.sessionManager.setEventHandlers({
    onStatusChange: (sessionId, status) => {
      const session = app.sessionManager.getSession(sessionId);
      void notifyWebhook(gatewayWebhookUrl, webhookHmacSecret, {
        session_id: sessionId,
        status,
        phone_number: session?.phoneNumber ?? null,
        display_name: session?.displayName ?? null,
      });
    },
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
  app.get<{ Params: { id: string } }>('/:id/qr', async (request, reply) => {
    const { id } = request.params;

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
      session = await app.sessionManager.createSession(id);
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
      app.sessionManager.setEventHandlers({
        onStatusChange: (sid, st) => {
          const s = app.sessionManager.getSession(sid);
          void notifyWebhook(gatewayWebhookUrl, webhookHmacSecret, {
            session_id: sid,
            status: st,
            phone_number: s?.phoneNumber ?? null,
            display_name: s?.displayName ?? null,
          });
        },
      });
      sendEvent('done', { session_id: id, status });
      res.end();
    };

    // Override event handlers for the duration of this SSE connection so we
    // can forward QR updates and status changes to *this* HTTP response.
    app.sessionManager.setEventHandlers({
      onStatusChange: (sessionId, status) => {
        // Always propagate to Supabase
        const s = app.sessionManager.getSession(sessionId);
        void notifyWebhook(gatewayWebhookUrl, webhookHmacSecret, {
          session_id: sessionId,
          status,
          phone_number: s?.phoneNumber ?? null,
          display_name: s?.displayName ?? null,
        });

        if (sessionId !== id) return;

        sendEvent('status', { session_id: id, status });

        if (status === 'connected') {
          finish('connected');
        } else if (status === 'disconnected') {
          finish('disconnected');
        }
      },
      onQrCode: (sessionId, qr) => {
        if (sessionId !== id) return;
        sendEvent('qr', { session_id: id, qr });
      },
    });

    // Auto-close after 60 s
    const timeoutHandle = setTimeout(() => {
      if (!finished) {
        finished = true;
        sendEvent('done', { session_id: id, status: 'timeout' });
        res.end();
        // Restore global handlers after SSE stream expires
        app.sessionManager.setEventHandlers({
          onStatusChange: (sid, st) => {
            const s = app.sessionManager.getSession(sid);
            void notifyWebhook(gatewayWebhookUrl, webhookHmacSecret, {
              session_id: sid,
              status: st,
              phone_number: s?.phoneNumber ?? null,
              display_name: s?.displayName ?? null,
            });
          },
        });
      }
    }, QR_STREAM_TIMEOUT_MS);

    // Cleanup if the client disconnects early
    request.socket.on('close', () => {
      if (!finished) {
        finished = true;
        clearTimeout(timeoutHandle);
        // Restore the global webhook-only handler
        app.sessionManager.setEventHandlers({
          onStatusChange: (sid, st) => {
            const s = app.sessionManager.getSession(sid);
            void notifyWebhook(gatewayWebhookUrl, webhookHmacSecret, {
              session_id: sid,
              status: st,
              phone_number: s?.phoneNumber ?? null,
              display_name: s?.displayName ?? null,
            });
          },
        });
      }
    });
  });

  // ── POST /sessions/:id/disconnect ────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/disconnect', async (request, reply) => {
    const { id } = request.params;

    const session = app.sessionManager.getSession(id);
    if (!session) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Session '${id}' does not exist`,
      });
    }

    await app.sessionManager.disconnectSession(id);

    return reply.send({ session_id: id, status: 'disconnected' });
  });
}
