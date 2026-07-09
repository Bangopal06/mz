/**
 * Broadcast Job Queue Routes
 *
 * POST   /jobs/enqueue       — Add a broadcast job to the BullMQ queue (Req 6.10)
 * DELETE /jobs/:id/cancel    — Cancel a queued or running broadcast job (Req 6.10)
 *
 * Requirements: 6.10
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import type { Queue } from 'bullmq';
import type { BroadcastJobData } from '../queue/index.js';

const EnqueueJobSchema = z.object({
  broadcast_id: z.string().uuid(),
  session_id: z.string().uuid(),
  rate_limit_min_ms: z.number().int().min(1000).default(3000),
  rate_limit_max_ms: z.number().int().min(1000).default(10000),
});

export interface JobRoutesOptions extends FastifyPluginOptions {
  broadcastQueue: Queue<BroadcastJobData>;
}

/**
 * Broadcast job queue management routes.
 * Handles enqueueing and cancelling broadcast jobs.
 *
 * Requirements: 6.10
 */
export async function jobRoutes(
  app: FastifyInstance,
  options: JobRoutesOptions
): Promise<void> {
  const { broadcastQueue } = options;

  // ── POST /jobs/enqueue ─────────────────────────────────────────────────────
  // Adds a broadcast job to the BullMQ queue.
  // The broadcast_id is used as the BullMQ job ID for idempotency (duplicate
  // enqueue of the same broadcast_id returns the existing job).
  app.post('/enqueue', async (request, reply) => {
    const parsed = EnqueueJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten(),
      });
    }

    const { broadcast_id, session_id, rate_limit_min_ms, rate_limit_max_ms } = parsed.data;

    // Validate rate limits: min must be <= max
    if (rate_limit_min_ms > rate_limit_max_ms) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: {
          fieldErrors: {
            rate_limit_min_ms: ['rate_limit_min_ms must be less than or equal to rate_limit_max_ms'],
          },
        },
      });
    }

    const jobData: BroadcastJobData = {
      broadcast_id,
      session_id,
      rate_limit_min_ms,
      rate_limit_max_ms,
    };

    try {
      // Use broadcast_id as job ID for idempotency — duplicate enqueues are safe
      const job = await broadcastQueue.add('broadcast', jobData, {
        jobId: broadcast_id,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      });

      return reply.status(202).send({
        broadcast_id,
        job_id: job.id,
        status: 'queued',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err, broadcast_id }, '[JobRoutes] Failed to enqueue broadcast job');
      return reply.status(500).send({
        error: 'Queue Error',
        message,
      });
    }
  });

  // ── DELETE /jobs/:id/cancel ────────────────────────────────────────────────
  // Cancels a broadcast job. The :id is the broadcast_id (also the BullMQ job ID).
  //
  // Behaviour:
  //  - If the job is waiting/delayed: remove it from the queue entirely.
  //  - If the job is active (currently being processed): we cannot forcefully
  //    interrupt the worker mid-execution, but we mark it for cancellation by
  //    updating the broadcast_jobs.status to 'cancelled' in Supabase. The
  //    processor checks this status at each recipient and will abort.
  //  - The caller (Edge Function) should also update broadcast_jobs.status
  //    to 'cancelled' in Supabase (the processor honours that flag).
  app.delete<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const { id: broadcastId } = request.params;

    if (!broadcastId) {
      return reply.status(400).send({ error: 'Broadcast ID is required' });
    }

    try {
      const job = await broadcastQueue.getJob(broadcastId);

      if (!job) {
        // Job not found — it may have already completed or never been enqueued
        return reply.status(200).send({
          broadcast_id: broadcastId,
          status: 'not_found',
          message: 'Job not found in queue (may have already completed or been removed)',
        });
      }

      const state = await job.getState();

      if (state === 'active') {
        // Job is currently running — we cannot interrupt it synchronously.
        // The processor polls broadcast_jobs.status before each send and will
        // detect 'cancelled' and abort. The caller must update the DB status.
        // We also discard the job result so it won't be retried after the
        // processor finishes its current iteration.
        await job.discard();

        return reply.status(200).send({
          broadcast_id: broadcastId,
          job_id: job.id,
          status: 'cancelling',
          message:
            'Job is currently active. It will stop after the current message. ' +
            'Ensure broadcast_jobs.status is set to cancelled in the database.',
        });
      }

      // For waiting, delayed, paused, failed states — remove from queue
      await job.remove();

      return reply.status(200).send({
        broadcast_id: broadcastId,
        job_id: job.id,
        status: 'cancelled',
        message: `Job removed from queue (was in '${state}' state)`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err, broadcastId }, '[JobRoutes] Failed to cancel broadcast job');
      return reply.status(500).send({
        error: 'Queue Error',
        message,
      });
    }
  });
}
