/**
 * Broadcast Resume Logic
 *
 * When the gateway reconnects (startup or after a disconnection event),
 * this module queries Supabase for broadcast_jobs with status = 'paused'
 * and re-enqueues them into BullMQ so they resume from last_sent_index + 1.
 *
 * The broadcast-processor uses last_sent_index to skip already-sent recipients
 * by fetching only recipients with send_order > last_sent_index.
 *
 * Requirements: 6.8
 */

import type { Queue } from 'bullmq';
import type { BroadcastJobData } from './index.js';

interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

interface PausedBroadcastRow {
  id: string;
  wa_session_id: string;
  last_sent_index: number;
  rate_limit_min_ms: number;
  rate_limit_max_ms: number;
}

/**
 * Fetches all broadcast_jobs with status = 'paused' from Supabase.
 *
 * Requirements: 6.8 — "Saat gateway reconnect, query broadcast dengan status paused"
 */
async function fetchPausedBroadcasts(cfg: SupabaseConfig): Promise<PausedBroadcastRow[]> {
  const url =
    `${cfg.url}/rest/v1/broadcast_jobs` +
    `?status=eq.paused` +
    `&select=id,wa_session_id,last_sent_index,rate_limit_min_ms,rate_limit_max_ms`;

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.serviceRoleKey,
      Authorization: `Bearer ${cfg.serviceRoleKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fetchPausedBroadcasts failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Checks whether a job for the given broadcast_id already exists in the
 * BullMQ queue (waiting, active, delayed, or paused state) to avoid
 * duplicate enqueues.
 */
async function isAlreadyQueued(
  queue: Queue<BroadcastJobData>,
  broadcastId: string
): Promise<boolean> {
  // BullMQ job IDs are set to the broadcast_id when enqueued via resumePausedBroadcasts
  const job = await queue.getJob(broadcastId);
  if (!job) return false;
  const state = await job.getState();
  return state === 'waiting' || state === 'active' || state === 'delayed' || state === 'paused';
}

/**
 * Queries Supabase for all paused broadcasts and re-enqueues them into BullMQ.
 * Called at gateway startup and optionally after a WhatsApp session reconnects.
 *
 * Requirements: 6.8
 */
export async function resumePausedBroadcasts(
  queue: Queue<BroadcastJobData>,
  supabase: SupabaseConfig
): Promise<void> {
  let paused: PausedBroadcastRow[];

  try {
    paused = await fetchPausedBroadcasts(supabase);
  } catch (err) {
    console.error('[BroadcastResume] Failed to fetch paused broadcasts:', err);
    return;
  }

  if (paused.length === 0) {
    console.info('[BroadcastResume] No paused broadcasts found');
    return;
  }

  console.info(`[BroadcastResume] Found ${paused.length} paused broadcast(s) — re-enqueueing`);

  for (const row of paused) {
    try {
      // Avoid duplicate if already in queue
      const alreadyQueued = await isAlreadyQueued(queue, row.id);
      if (alreadyQueued) {
        console.info(`[BroadcastResume] Broadcast ${row.id} is already queued — skipping`);
        continue;
      }

      const jobData: BroadcastJobData = {
        broadcast_id: row.id,
        session_id: row.wa_session_id,
        rate_limit_min_ms: row.rate_limit_min_ms,
        rate_limit_max_ms: row.rate_limit_max_ms,
      };

      // Use broadcast_id as the BullMQ job ID for idempotency
      await queue.add('broadcast', jobData, {
        jobId: row.id,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      });

      console.info(
        `[BroadcastResume] Re-enqueued broadcast ${row.id} ` +
          `(resuming from send_order > ${row.last_sent_index})`
      );
    } catch (err) {
      console.error(`[BroadcastResume] Failed to re-enqueue broadcast ${row.id}:`, err);
    }
  }
}
