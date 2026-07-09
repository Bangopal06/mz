import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config/index.js';

const SendMessageSchema = z.object({
  session_id: z.string().uuid(),
  to: z.string().regex(/^62\d{8,13}$/, 'Invalid WA number format (must start with 62)'),
  message: z.string().min(1),
  media: z
    .object({
      url: z.string().url(),
      mime_type: z.string(),
      caption: z.string().optional(),
    })
    .optional(),
});

/** Options passed when registering this plugin. */
export interface SendRoutesOptions extends FastifyPluginOptions {
  config: AppConfig;
}

/**
 * Updates `last_active_at` and `expires_at` on a wa_sessions row in Supabase
 * after a message is successfully sent.
 *
 * expires_at = last_active_at + 30 days  (Requirement 8.5)
 *
 * Fire-and-forget: errors are logged but do not throw.
 */
async function updateSessionActivity(
  supabaseUrl: string,
  serviceRoleKey: string,
  sessionId: string
): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

    const body = JSON.stringify({
      last_active_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    });

    const url = `${supabaseUrl}/rest/v1/wa_sessions?id=eq.${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: 'return=minimal',
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(
        `[SendRoutes] Failed to update session activity for ${sessionId}: ${res.status} ${text}`
      );
    }
  } catch (err) {
    console.error(`[SendRoutes] Error updating session activity for ${sessionId}:`, err);
  }
}

/**
 * Maps a MIME type to the Baileys message content for media messages.
 * Returns the appropriate content object based on the MIME type family.
 */
function buildMediaContent(
  buffer: Buffer,
  mimeType: string,
  caption?: string
): Record<string, unknown> {
  if (mimeType.startsWith('image/')) {
    return { image: buffer, mimetype: mimeType, caption };
  }
  if (mimeType.startsWith('video/')) {
    return { video: buffer, mimetype: mimeType, caption };
  }
  // PDF, DOCX, XLSX and other documents
  return { document: buffer, mimetype: mimeType, caption };
}

/**
 * Downloads media from the given URL and returns its content as a Buffer.
 * Throws an error with code MEDIA_DOWNLOAD_FAILED on any network or HTTP error.
 */
async function downloadMedia(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const error: NodeJS.ErrnoException = new Error(
      `Network error while downloading media: ${cause}`
    );
    (error as any).code = 'MEDIA_DOWNLOAD_FAILED';
    throw error;
  }

  if (!response.ok) {
    const error: NodeJS.ErrnoException = new Error(
      `Failed to download media: HTTP ${response.status} from ${url}`
    );
    (error as any).code = 'MEDIA_DOWNLOAD_FAILED';
    throw error;
  }

  try {
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const error: NodeJS.ErrnoException = new Error(
      `Failed to read media response body: ${cause}`
    );
    (error as any).code = 'MEDIA_DOWNLOAD_FAILED';
    throw error;
  }
}

/**
 * Message send route.
 * Sends a single text or media message via a WhatsApp session.
 * After each successful send, updates last_active_at and expires_at
 * on the wa_sessions record (Requirement 8.5).
 *
 * Requirements: 6.6, 11.7
 */
export async function sendRoutes(app: FastifyInstance, options: SendRoutesOptions): Promise<void> {
  const { config } = options;

  // POST /send — send a single message
  app.post('/', async (request, reply) => {
    // ── 1. Input validation ────────────────────────────────────────────────────
    const parsed = SendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten(),
      });
    }

    const { session_id, to, message, media } = parsed.data;

    // ── 2. Session lookup and status check ────────────────────────────────────
    const sessionInfo = app.sessionManager.getSession(session_id);

    if (!sessionInfo) {
      return reply.status(409).send({
        error: 'Session Not Found',
        error_code: 'SESSION_NOT_FOUND',
        message: `Session '${session_id}' does not exist`,
      });
    }

    if (sessionInfo.status !== 'connected') {
      return reply.status(409).send({
        error: 'Session Not Connected',
        error_code: 'SESSION_NOT_CONNECTED',
        message: `Session '${session_id}' is currently '${sessionInfo.status}', must be 'connected' to send messages`,
      });
    }

    const socket = sessionInfo.socket;
    const jid = `${to}@s.whatsapp.net`;

    // ── 3. Send message (text or media) ───────────────────────────────────────
    let sentMessage: Awaited<ReturnType<typeof socket.sendMessage>>;

    try {
      if (media) {
        // Download media from Supabase Storage URL before sending
        let mediaBuffer: Buffer;
        try {
          mediaBuffer = await downloadMedia(media.url);
        } catch (err: any) {
          return reply.status(502).send({
            error: 'Media Download Failed',
            error_code: err.code ?? 'MEDIA_DOWNLOAD_FAILED',
            message: err.message,
          });
        }

        const mediaContent = buildMediaContent(mediaBuffer, media.mime_type, media.caption);
        sentMessage = await socket.sendMessage(jid, mediaContent);
      } else {
        // Text-only message
        sentMessage = await socket.sendMessage(jid, { text: message });
      }
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Map known Baileys errors to specific error codes
      let errorCode = 'SEND_FAILED';
      if (
        errorMessage.includes('not-authorized') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('Connection Closed')
      ) {
        errorCode = 'SESSION_NOT_CONNECTED';
      } else if (errorMessage.includes('invalid') && errorMessage.includes('jid')) {
        errorCode = 'INVALID_RECIPIENT';
      } else if (errorMessage.includes('rate') || errorMessage.includes('limit')) {
        errorCode = 'RATE_LIMITED';
      }

      return reply.status(502).send({
        error: 'Send Failed',
        error_code: errorCode,
        message: errorMessage,
      });
    }

    // ── 4. Update session activity (fire-and-forget, Requirement 8.5) ─────────
    void updateSessionActivity(config.supabase.url, config.supabase.serviceRoleKey, session_id);

    // ── 5. Return ACK ─────────────────────────────────────────────────────────
    const messageId = sentMessage?.key?.id ?? crypto.randomUUID();
    const timestamp = new Date().toISOString();

    return reply.status(200).send({
      message_id: messageId,
      to,
      status: 'sent',
      timestamp,
    });
  });
}
