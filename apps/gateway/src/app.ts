import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { AppConfig } from './config/index.js';
import { jobRoutes, type JobRoutesOptions } from './routes/jobs.js';
import { sendRoutes, type SendRoutesOptions } from './routes/send.js';
import { sessionRoutes, type SessionRoutesOptions } from './routes/sessions.js';
import { apiKeyMiddleware } from './middleware/auth.js';
import { SessionManager } from './whatsapp/session-manager.js';
import {
  createBroadcastQueue,
  createBroadcastWorker,
  buildBroadcastProcessor,
  type BroadcastJobData,
} from './queue/index.js';
import { resumePausedBroadcasts } from './queue/resume.js';

export interface AppOptions {
  logger?: boolean | object;
  config: AppConfig;
  /** Optional pre-built session manager (used in tests to inject a mock). */
  sessionManager?: SessionManager;
  /** Optional pre-built queue (used in tests to inject a mock). */
  broadcastQueue?: Queue<BroadcastJobData>;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { logger, config } = options;

  const app = Fastify({
    logger: logger ?? false,
  });

  // Security middleware
  await app.register(helmet);
  await app.register(cors, {
    origin: false, // Gateway is internal, no CORS needed
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // API key authentication for all routes
  app.addHook('onRequest', apiKeyMiddleware(config.gatewayApiKey));

  // Health check (no auth required — registered before auth hook)
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Session Manager ──────────────────────────────────────────────────────
  const sessionManager =
    options.sessionManager ?? new SessionManager(config.sessionStorePath, {
      url: config.supabase.url,
      serviceRoleKey: config.supabase.serviceRoleKey,
    });

  // Decorate app so routes can access the session manager
  app.decorate('sessionManager', sessionManager);

  // ── BullMQ Queue & Worker ────────────────────────────────────────────────
  const broadcastQueue: Queue<BroadcastJobData> =
    options.broadcastQueue ??
    (() => {
      const redisConnection: { host: string; port: number; password?: string; db?: number } = {
        host: config.redis.host,
        port: config.redis.port,
        db: config.redis.db,
      };
      if (config.redis.password) {
        redisConnection.password = config.redis.password;
      }

      const queue = createBroadcastQueue(redisConnection);

      // Build and start the worker (only when not injected — i.e. not in tests)
      const processor = buildBroadcastProcessor(
        sessionManager,
        config.supabase.url,
        config.supabase.serviceRoleKey
      );
      const worker = createBroadcastWorker(redisConnection, processor);

      worker.on('completed', (job) => {
        app.log.info({ jobId: job.id, broadcastId: job.data.broadcast_id }, '[Queue] Job completed');
      });

      worker.on('failed', (job, err) => {
        app.log.error(
          { jobId: job?.id, broadcastId: job?.data?.broadcast_id, err },
          '[Queue] Job failed'
        );
      });

      // Resume any paused broadcasts on startup (Req 6.8)
      void resumePausedBroadcasts(queue, {
        url: config.supabase.url,
        serviceRoleKey: config.supabase.serviceRoleKey,
      });

      return queue;
    })();

  // ── Routes ───────────────────────────────────────────────────────────────
  await app.register(sessionRoutes, { prefix: '/sessions', config } as SessionRoutesOptions);
  await app.register(jobRoutes, {
    prefix: '/jobs',
    broadcastQueue,
  } as JobRoutesOptions);
  await app.register(sendRoutes, { prefix: '/send', config } as SendRoutesOptions);

  return app;
}
