import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from './app.js';
import type { AppConfig } from './config/index.js';
import type { Queue } from 'bullmq';
import type { BroadcastJobData } from './queue/index.js';

/** Minimal mock queue that avoids real Redis connections in tests */
function buildMockQueue(): Queue<BroadcastJobData> {
  return {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
    getJob: vi.fn().mockResolvedValue(null),
  } as unknown as Queue<BroadcastJobData>;
}

const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 3001,
  host: '127.0.0.1',
  redis: {
    host: 'localhost',
    port: 6379,
    password: undefined,
    db: 0,
  },
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

describe('Gateway App', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      config: testConfig,
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds to health check without API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  it('rejects requests without API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sessions',
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts requests with valid API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: {
        'x-api-key': testConfig.gatewayApiKey,
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects enqueue with invalid payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      headers: {
        'x-api-key': testConfig.gatewayApiKey,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ invalid: 'data' }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects send with invalid WA number', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/send',
      headers: {
        'x-api-key': testConfig.gatewayApiKey,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        to: '081234567890', // invalid format
        message: 'Hello',
      }),
    });
    expect(response.statusCode).toBe(400);
  });
});
