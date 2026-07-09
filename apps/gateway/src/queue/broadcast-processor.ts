/**
 * Broadcast Job Processor
 *
 * Processes a single broadcast job from BullMQ:
 *  1. Fetches pending recipients from Supabase starting from last_sent_index + 1
 *  2. For each recipient, sends the message via the WhatsApp session with per-message retry logic
 *  3. Applies random delay [rate_limit_min_ms, rate_limit_max_ms] between messages (Req 6.5)
 *  4. Updates last_sent_index in broadcast_jobs after each successful send (Req 6.8)
 *  5. Logs send result (sent / failed) + error details to message_logs (Req 6.6, 10.4)
 *  6. Marks broadcast_jobs.status = 'completed' when all recipients are processed (Req 6.6)
 *
 * Requirements: 6.5, 6.6, 6.8, 10.4
 */

import type { Job } from 'bullmq';
import type { SessionManager } from '../whatsapp/session-manager.js';
import type { BroadcastJobData } from './index.js';

/** Retry schedule for per-message failures: delays before attempt 2 and 3 */
const RETRY_DELAYS_MS = [0, 5_000, 15_000];

/** Maximum per-message attempts (first + 2 retries = 3 total) */
const MAX_ATTEMPTS = 3;

// ── Supabase REST helpers ─────────────────────────────────────────────────────

interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

/** Common headers for Supabase REST requests */
function supabaseHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Prefer: 'return=representation',
  };
}

/** Minimal shape returned from broadcast_jobs + broadcast_recipients join query */
export interface BroadcastJobRow {
  id: string;
  message_body: string;
  attachment_id: string | null;
  wa_session_id: string;
  wa_session_key: string; // session_key used by gateway
  status: string;
  last_sent_index: number;
  total_recipients: number;
  rate_limit_min_ms: number;
  rate_limit_max_ms: number;
}

export interface RecipientRow {
  id: string;
  broadcast_id: string;
  contact_id: string;
  send_order: number;
  contacts: {
    full_name: string;
    wa_number: string;
  };
}

export interface MediaAttachmentRow {
  storage_path: string;
  mime_type: string;
  caption: string | null;
}

/** Fetches the broadcast_jobs row including session_key via join */
async function fetchBroadcastJob(
  cfg: SupabaseConfig,
  broadcastId: string
): Promise<BroadcastJobRow | null> {
  const url = `${cfg.url}/rest/v1/broadcast_jobs?id=eq.${encodeURIComponent(broadcastId)}&select=id,message_body,attachment_id,wa_session_id,status,last_sent_index,total_recipients,rate_limit_min_ms,rate_limit_max_ms,wa_sessions(session_key)&limit=1`;
  const res = await fetch(url, { headers: supabaseHeaders(cfg.serviceRoleKey) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fetchBroadcastJob failed: ${res.status} ${text}`);
  }
  const rows: (Omit<BroadcastJobRow, 'wa_session_key'> & { wa_sessions: { session_key: string } | null })[] = await res.json();
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    wa_session_key: row.wa_sessions?.session_key ?? row.wa_session_id,
  };
}

/**
 * Fetches pending recipients for a broadcast, ordered by send_order,
 * starting from the given offset (exclusive, i.e. send_order > startAfterOrder).
 *
 * Uses offset-based pagination to restart from last_sent_index + 1.
 */
async function fetchPendingRecipients(
  cfg: SupabaseConfig,
  broadcastId: string,
  startAfterOrder: number
): Promise<RecipientRow[]> {
  const url =
    `${cfg.url}/rest/v1/broadcast_recipients` +
    `?broadcast_id=eq.${encodeURIComponent(broadcastId)}` +
    `&send_order=gt.${startAfterOrder}` +
    `&select=id,broadcast_id,contact_id,send_order,contacts(full_name,wa_number)` +
    `&order=send_order.asc`;
  const res = await fetch(url, { headers: supabaseHeaders(cfg.serviceRoleKey) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fetchPendingRecipients failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** Fetches media attachment metadata */
async function fetchMediaAttachment(
  cfg: SupabaseConfig,
  attachmentId: string
): Promise<MediaAttachmentRow | null> {
  const url = `${cfg.url}/rest/v1/media_attachments?id=eq.${encodeURIComponent(attachmentId)}&select=storage_path,mime_type,caption&limit=1`;
  const res = await fetch(url, { headers: supabaseHeaders(cfg.serviceRoleKey) });
  if (!res.ok) return null;
  const rows: MediaAttachmentRow[] = await res.json();
  return rows[0] ?? null;
}

/**
 * Updates last_sent_index and increments sent_count / failed_count on the
 * broadcast_jobs row after each message is processed.
 */
async function updateBroadcastProgress(
  cfg: SupabaseConfig,
  broadcastId: string,
  lastSentIndex: number,
  delta: { sent?: number; failed?: number }
): Promise<void> {
  // We use raw_sql style updates with Supabase REST; since REST PATCH doesn't
  // support arithmetic updates natively, we use the PostgREST RPC approach.
  // Instead we do a read-then-write for simplicity. This is acceptable because
  // BullMQ concurrency is 1 per session so there is no concurrent update race.
  const readUrl = `${cfg.url}/rest/v1/broadcast_jobs?id=eq.${encodeURIComponent(broadcastId)}&select=sent_count,failed_count&limit=1`;
  const readRes = await fetch(readUrl, { headers: supabaseHeaders(cfg.serviceRoleKey) });
  let sentCount = 0;
  let failedCount = 0;
  if (readRes.ok) {
    const rows: { sent_count: number; failed_count: number }[] = await readRes.json();
    if (rows[0]) {
      sentCount = rows[0].sent_count;
      failedCount = rows[0].failed_count;
    }
  }

  const body = JSON.stringify({
    last_sent_index: lastSentIndex,
    sent_count: sentCount + (delta.sent ?? 0),
    failed_count: failedCount + (delta.failed ?? 0),
    updated_at: new Date().toISOString(),
  });

  const url = `${cfg.url}/rest/v1/broadcast_jobs?id=eq.${encodeURIComponent(broadcastId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(cfg.serviceRoleKey), Prefer: 'return=minimal' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[BroadcastProcessor] updateBroadcastProgress failed: ${res.status} ${text}`);
  }
}

/** Updates broadcast_jobs.status */
async function updateBroadcastStatus(
  cfg: SupabaseConfig,
  broadcastId: string,
  status: 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
): Promise<void> {
  const now = new Date().toISOString();
  const body: Record<string, unknown> = {
    status,
    updated_at: now,
  };
  if (status === 'running') body['started_at'] = now;
  if (status === 'completed') body['completed_at'] = now;

  const url = `${cfg.url}/rest/v1/broadcast_jobs?id=eq.${encodeURIComponent(broadcastId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(cfg.serviceRoleKey), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[BroadcastProcessor] updateBroadcastStatus(${status}) failed: ${res.status} ${text}`);
  }
}

/**
 * Upserts a message_logs row for the given broadcast / contact with status and error info.
 * Uses upsert (ON CONFLICT DO UPDATE) keyed on (broadcast_id, contact_id).
 */
async function upsertMessageLog(
  cfg: SupabaseConfig,
  entry: {
    broadcast_id: string;
    contact_id: string;
    wa_number: string;
    status: 'sent' | 'failed';
    error_code?: string;
    error_message?: string;
    sent_at?: string;
  }
): Promise<void> {
  const body = JSON.stringify({
    ...entry,
    created_at: new Date().toISOString(),
  });

  const url = `${cfg.url}/rest/v1/message_logs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(cfg.serviceRoleKey),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[BroadcastProcessor] upsertMessageLog failed: ${res.status} ${text}`);
  }
}

// ── Utility helpers ───────────────────────────────────────────────────────────

/** Returns a random integer delay in [min, max] ms */
export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

/** Sleeps for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Per-message retry logic ───────────────────────────────────────────────────

interface SendAttemptResult {
  success: boolean;
  error_code?: string;
  error_message?: string;
}

/**
 * Attempts to send a single WhatsApp message with up to MAX_ATTEMPTS tries.
 * Retry delays: [0ms, 5s, 15s] (Req 6.6 / design retry strategy).
 */
async function sendWithRetry(
  sessionManager: SessionManager,
  sessionId: string,
  to: string,
  message: string,
  media?: { url: string; mime_type: string; caption?: string }
): Promise<SendAttemptResult> {
  let lastError: { code: string; message: string } = { code: 'UNKNOWN', message: 'Unknown error' };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Apply delay before attempt 2 and 3 (attempt index > 0)
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }

    try {
      const sessionInfo = sessionManager.getSession(sessionId);
      if (!sessionInfo || sessionInfo.status !== 'connected') {
        // Session disconnected — stop retrying; let the job be paused
        return {
          success: false,
          error_code: 'SESSION_NOT_CONNECTED',
          error_message: `Session ${sessionId} is not connected`,
        };
      }

      const jid = `${to}@s.whatsapp.net`;

      if (media) {
        // Download media and send
        const mediaRes = await fetch(media.url);
        if (!mediaRes.ok) {
          throw Object.assign(new Error(`Media download failed: ${mediaRes.status}`), {
            code: 'MEDIA_DOWNLOAD_FAILED',
          });
        }
        const buffer = Buffer.from(await mediaRes.arrayBuffer());
        let content: Record<string, unknown>;
        if (media.mime_type.startsWith('image/')) {
          content = { image: buffer, mimetype: media.mime_type, caption: media.caption };
        } else if (media.mime_type.startsWith('video/')) {
          content = { video: buffer, mimetype: media.mime_type, caption: media.caption };
        } else {
          content = { document: buffer, mimetype: media.mime_type, caption: media.caption };
        }
        await sessionInfo.socket.sendMessage(jid, content);
      } else {
        await sessionInfo.socket.sendMessage(jid, { text: message });
      }

      return { success: true };
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string };
      const code = errObj.code ?? 'SEND_FAILED';
      const msg = errObj.message ?? String(err);

      lastError = { code, message: msg };
      console.warn(
        `[BroadcastProcessor] Attempt ${attempt + 1}/${MAX_ATTEMPTS} failed for ${to}: [${code}] ${msg}`
      );

      // If session disconnected, abort retries immediately
      if (code === 'SESSION_NOT_CONNECTED') {
        return { success: false, error_code: code, error_message: msg };
      }
    }
  }

  // All attempts exhausted
  return {
    success: false,
    error_code: lastError.code,
    error_message: lastError.message,
  };
}

// ── Main processor ────────────────────────────────────────────────────────────

export interface ProcessorDeps {
  sessionManager: SessionManager;
  supabase: SupabaseConfig;
}

/**
 * Main broadcast job processor.
 * Called by the BullMQ worker for each job dequeued from `broadcast-queue`.
 *
 * Requirements: 6.5 (rate limiter), 6.6 (message logging), 6.8 (resume via last_sent_index)
 */
export async function processBroadcastJob(
  job: Job<BroadcastJobData>,
  deps: ProcessorDeps
): Promise<void> {
  const { broadcast_id, session_id: sessionIdFromQueue, rate_limit_min_ms, rate_limit_max_ms } = job.data;
  const { sessionManager, supabase } = deps;

  console.info(`[BroadcastProcessor] Starting job ${job.id} for broadcast ${broadcast_id}`);

  // ── 1. Fetch broadcast job row ────────────────────────────────────────────
  const broadcastJob = await fetchBroadcastJob(supabase, broadcast_id);
  if (!broadcastJob) {
    throw new Error(`Broadcast job ${broadcast_id} not found in database`);
  }

  // Use session_key (gateway identifier), fallback to queue session_id
  const session_id = broadcastJob.wa_session_key || sessionIdFromQueue;

  // Abort if the broadcast was cancelled externally
  if (broadcastJob.status === 'cancelled') {
    console.info(`[BroadcastProcessor] Broadcast ${broadcast_id} is cancelled — skipping`);
    return;
  }

  // Mark as running
  await updateBroadcastStatus(supabase, broadcast_id, 'running');

  // ── 2. Fetch media attachment if any ─────────────────────────────────────
  let media: { url: string; mime_type: string; caption?: string } | undefined;
  if (broadcastJob.attachment_id) {
    const attachment = await fetchMediaAttachment(supabase, broadcastJob.attachment_id);
    if (attachment) {
      media = {
        url: `${supabase.url}/storage/v1/object/public/media-attachments/${attachment.storage_path}`,
        mime_type: attachment.mime_type,
        caption: attachment.caption ?? undefined,
      };
    }
  }

  // ── 3. Fetch pending recipients starting from last_sent_index ────────────
  const startAfterOrder = broadcastJob.last_sent_index;
  const recipients = await fetchPendingRecipients(supabase, broadcast_id, startAfterOrder);

  console.info(
    `[BroadcastProcessor] Processing ${recipients.length} recipients ` +
      `(starting after send_order=${startAfterOrder})`
  );

  if (recipients.length === 0) {
    // All already sent — mark complete
    await updateBroadcastStatus(supabase, broadcast_id, 'completed');
    return;
  }

  // ── 4. Process each recipient ─────────────────────────────────────────────
  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i]!;
    const { contact_id, send_order } = recipient;
    const waNumber = recipient.contacts.wa_number;
    const contactName = recipient.contacts.full_name;

    // Check if session is still connected before each send
    const sessionInfo = sessionManager.getSession(session_id);
    if (!sessionInfo || sessionInfo.status !== 'connected') {
      console.warn(
        `[BroadcastProcessor] Session ${session_id} disconnected at send_order=${send_order} — pausing broadcast`
      );
      await updateBroadcastStatus(supabase, broadcast_id, 'paused');
      return;
    }

    // Personalize message body: replace {{nama}} and {{nomor}}
    const personalizedMessage = broadcastJob.message_body
      .replace(/\{\{nama\}\}/gi, contactName)
      .replace(/\{\{nomor\}\}/gi, waNumber);

    // Attempt to send with retry logic (Req 6.6, 10.4)
    const result = await sendWithRetry(
      sessionManager,
      session_id,
      waNumber,
      personalizedMessage,
      media
    );

    if (result.success) {
      const sentAt = new Date().toISOString();

      // Update last_sent_index and increment sent_count in DB (Req 6.8)
      await updateBroadcastProgress(supabase, broadcast_id, send_order, { sent: 1 });

      // Log successful delivery to message_logs
      await upsertMessageLog(supabase, {
        broadcast_id,
        contact_id,
        wa_number: waNumber,
        status: 'sent',
        sent_at: sentAt,
      });

      console.info(
        `[BroadcastProcessor] ✓ Sent to ${waNumber} (send_order=${send_order}, ${i + 1}/${recipients.length})`
      );
    } else {
      // All retries exhausted — mark as failed, continue to next recipient (Req 6.6, 10.4)
      await updateBroadcastProgress(supabase, broadcast_id, send_order, { failed: 1 });

      await upsertMessageLog(supabase, {
        broadcast_id,
        contact_id,
        wa_number: waNumber,
        status: 'failed',
        error_code: result.error_code,
        error_message: result.error_message,
      });

      console.warn(
        `[BroadcastProcessor] ✗ Failed to send to ${waNumber} after ${MAX_ATTEMPTS} attempts: ` +
          `[${result.error_code}] ${result.error_message}`
      );

      // If session disconnected, pause the broadcast and stop processing
      if (result.error_code === 'SESSION_NOT_CONNECTED') {
        await updateBroadcastStatus(supabase, broadcast_id, 'paused');
        return;
      }
    }

    // Apply rate limit delay between messages (not after the last one)
    if (i < recipients.length - 1) {
      const delay = randomDelay(rate_limit_min_ms, rate_limit_max_ms);
      console.info(`[BroadcastProcessor] Rate limit: waiting ${delay}ms before next message`);
      await sleep(delay);
    }
  }

  // ── 5. Mark broadcast as completed ───────────────────────────────────────
  await updateBroadcastStatus(supabase, broadcast_id, 'completed');
  console.info(`[BroadcastProcessor] Broadcast ${broadcast_id} completed`);
}
