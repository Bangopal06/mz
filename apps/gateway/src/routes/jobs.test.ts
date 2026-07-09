/**
 * Unit tests for broadcast job queue routes (Task 12.6).
 *
 * Covers:
 *  - POST /jobs/enqueue — validation, successful enqueue, duplicate handling
 *  - DELETE /jobs/:id/cancel — cancel waiting/active/not-found jobs
 *
 * Requirements: 6.10
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config/index.js';
import type { Queue } from 'bullmq';
import type { BroadcastJobData } from '../queue/index.js';
import type { SessionManager } from '../whatsapp/session-manager.js';
import type { WaSession } from '../types/index.js';

const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 3001,
  host: '127.0.0.1',
  redis: { host: 'localhost', port: 6379, password: undefined, db: 0 },
  supabase: {
    url: 'https://test.supabase.co',
    serviceRoleKey: 'test-service-role-key',
  },
  gatewayApiKey: 'test-api-key',
  webhookHmacSecret: 'test-hmac-secret',
  gatewayWebhookUrl: 'https://test.supabase.co/functions/v1/webhooks/session-status',
  sessionStorePath: './test-sessions',
  maxConcurrentSessions: 5,
  rateLimitMinMs: 3000,
  rateLimitMaxMs: 10000,
  queueConcurrency: 1,
};

const AUTH_HEADERS = {
  'x-api-key': testConfig.gatewayApiKey,
  'content-type': 'application/json',
};

const VALID_ENQUEUE_BODY = {
  broadcast_id: '123e4567-e89b-12d3-a456-426614174001',
  session_id: '123e4567-e89b-12d3-a456-426614174000',
  rate_limit_min_ms: 3000,
  rate_limit_max_ms: 10000,
};

/** Creates a minimal mock BullMQ queue */
function buildMockQueue(overrides: Partial<Queue<BroadcastJobData>> = {}): Queue<BroadcastJobData> {
  return {
    add: vi.fn().mockResolvedValue({ id: VALID_ENQUEUE_BODY.broadcast_id }),
    getJob: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as Queue<BroadcastJobData>;
}

function buildMockSessionManager(): SessionManager {
  return {
    getSessions: vi.fn(() => [] as WaSession[]),
    getSession: vi.fn(() => undefined),
    createSession: vi.fn(),
    disconnectSession: vi.fn(),
    getQrCode: vi.fn(() => undefined),
    setEventHandlers: vi.fn(),
    initialize: vi.fn(),
  } as unknown as SessionManager;
}

describe('POST /jobs/enqueue', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let mockQueue: Queue<BroadcastJobData>;

  beforeEach(async () => {
    mockQueue = buildMockQueue();
    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
      broadcastQueue: mockQueue,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(VALID_ENQUEUE_BODY),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({ broadcast_id: 'not-a-uuid' }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Validation Error');
  });

  it('returns 400 for non-UUID broadcast_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        ...VALID_ENQUEUE_BODY,
        broadcast_id: 'not-a-uuid',
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when rate_limit_min_ms > rate_limit_max_ms', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        ...VALID_ENQUEUE_BODY,
        rate_limit_min_ms: 10000,
        rate_limit_max_ms: 3000,
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Validation Error');
  });

  it('enqueues a valid broadcast job and returns 202', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: AUTH_HEADERS,
      payload: JSON.stringify(VALID_ENQUEUE_BODY),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.payload);
    expect(body.broadcast_id).toBe(VALID_ENQUEUE_BODY.broadcast_id);
    expect(body.status).toBe('queued');
    expect(body.job_id).toBeDefined();
  });

  it('calls queue.add with the broadcast_id as the job ID for idempotency', async () => {
    await app.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: AUTH_HEADERS,
      payload: JSON.stringify(VALID_ENQUEUE_BODY),
    });

    expect(mockQueue.add).toHaveBeenCalledWith(
      'broadcast',
      expect.objectContaining({
        broadcast_id: VALID_ENQUEUE_BODY.broadcast_id,
        session_id: VALID_ENQUEUE_BODY.session_id,
        rate_limit_min_ms: VALID_ENQUEUE_BODY.rate_limit_min_ms,
        rate_limit_max_ms: VALID_ENQUEUE_BODY.rate_limit_max_ms,
      }),
      expect.objectContaining({ jobId: VALID_ENQUEUE_BODY.broadcast_id })
    );
  });

  it('uses default rate limits when not provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        broadcast_id: VALID_ENQUEUE_BODY.broadcast_id,
        session_id: VALID_ENQUEUE_BODY.session_id,
      }),
    });

    expect(res.statusCode).toBe(202);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'broadcast',
      expect.objectContaining({
        rate_limit_min_ms: 3000,
        rate_limit_max_ms: 10000,
      }),
      expect.any(Object)
    );
  });

  it('returns 500 when queue throws an error', async () => {
    const errorQueue = buildMockQueue({
      add: vi.fn().mockRejectedValue(new Error('Redis connection error')),
    });
    const errorApp = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
      broadcastQueue: errorQueue,
    });
    await errorApp.ready();

    const res = await errorApp.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: AUTH_HEADERS,
      payload: JSON.stringify(VALID_ENQUEUE_BODY),
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Queue Error');

    await errorApp.close();
  });
});

describe('DELETE /jobs/:id/cancel', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterEach(async () => {
    await app?.close();
  });

  it('returns 200 with not_found when job does not exist in queue', async () => {
    const mockQueue = buildMockQueue({
      getJob: vi.fn().mockResolvedValue(null),
    });
    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
      broadcastQueue: mockQueue,
    });
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: `/jobs/${VALID_ENQUEUE_BODY.broadcast_id}/cancel`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('not_found');
  });

  it('removes a waiting job from the queue and returns cancelled', async () => {
    const removeJobSpy = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: VALID_ENQUEUE_BODY.broadcast_id,
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: removeJobSpy,
      discard: vi.fn(),
    };

    const mockQueue = buildMockQueue({
      getJob: vi.fn().mockResolvedValue(mockJob),
    });

    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
      broadcastQueue: mockQueue,
    });
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: `/jobs/${VALID_ENQUEUE_BODY.broadcast_id}/cancel`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('cancelled');
    expect(body.broadcast_id).toBe(VALID_ENQUEUE_BODY.broadcast_id);
    expect(removeJobSpy).toHaveBeenCalled();
  });

  it('returns cancelling status for an active job without removing it', async () => {
    const discardSpy = vi.fn().mockResolvedValue(undefined);
    const removeSpy = vi.fn();
    const mockJob = {
      id: VALID_ENQUEUE_BODY.broadcast_id,
      getState: vi.fn().mockResolvedValue('active'),
      remove: removeSpy,
      discard: discardSpy,
    };

    const mockQueue = buildMockQueue({
      getJob: vi.fn().mockResolvedValue(mockJob),
    });

    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
      broadcastQueue: mockQueue,
    });
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: `/jobs/${VALID_ENQUEUE_BODY.broadcast_id}/cancel`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('cancelling');
    expect(discardSpy).toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('removes a delayed job', async () => {
    const removeJobSpy = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: VALID_ENQUEUE_BODY.broadcast_id,
      getState: vi.fn().mockResolvedValue('delayed'),
      remove: removeJobSpy,
      discard: vi.fn(),
    };

    const mockQueue = buildMockQueue({
      getJob: vi.fn().mockResolvedValue(mockJob),
    });

    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
      broadcastQueue: mockQueue,
    });
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: `/jobs/${VALID_ENQUEUE_BODY.broadcast_id}/cancel`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('cancelled');
    expect(removeJobSpy).toHaveBeenCalled();
  });

  it('returns 401 without API key', async () => {
    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: `/jobs/${VALID_ENQUEUE_BODY.broadcast_id}/cancel`,
      // No API key header
    });

    expect(res.statusCode).toBe(401);
  });
});
