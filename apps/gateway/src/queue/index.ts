import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import type { SessionManager } from '../whatsapp/session-manager.js';
import { processBroadcastJob } from './broadcast-processor.js';

export { processBroadcastJob } from './broadcast-processor.js';

export const BROADCAST_QUEUE_NAME = 'broadcast-queue';

export interface BroadcastJobData {
  broadcast_id: string;
  session_id: string;
  rate_limit_min_ms: number;
  rate_limit_max_ms: number;
}

/**
 * Creates a BullMQ queue for broadcast jobs.
 * Concurrency is set to 1 per session to respect rate limiting.
 *
 * Requirements: 6.5
 */
export function createBroadcastQueue(connection: ConnectionOptions): Queue<BroadcastJobData> {
  return new Queue<BroadcastJobData>(BROADCAST_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });
}

/**
 * Creates a BullMQ worker to process broadcast jobs.
 *
 * Concurrency is 1 — only one broadcast job runs at a time per worker instance.
 * Since each gateway process manages its own sessions, this effectively provides
 * concurrency=1 per session as required.
 *
 * Requirements: 6.5
 */
export function createBroadcastWorker(
  connection: ConnectionOptions,
  processor: (job: Job<BroadcastJobData>) => Promise<void>
): Worker<BroadcastJobData> {
  return new Worker<BroadcastJobData>(BROADCAST_QUEUE_NAME, processor, {
    connection,
    concurrency: 1,
  });
}

/**
 * Builds the broadcast job processor function bound to the given dependencies.
 * Used in production to wire the session manager and Supabase config.
 */
export function buildBroadcastProcessor(
  sessionManager: SessionManager,
  supabaseUrl: string,
  supabaseServiceRoleKey: string
): (job: Job<BroadcastJobData>) => Promise<void> {
  return (job: Job<BroadcastJobData>) =>
    processBroadcastJob(job, {
      sessionManager,
      supabase: { url: supabaseUrl, serviceRoleKey: supabaseServiceRoleKey },
    });
}
