/**
 * Unit tests for WhatsApp session management routes (Task 11.2).
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config/index.js';
import type { SessionManager } from '../whatsapp/session-manager.js';
import type { WaSession } from '../types/index.js';
import type { Queue } from 'bullmq';
import type { BroadcastJobData } from '../queue/index.js';

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

const AUTH_HEADERS = { 'x-api-key': testConfig.gatewayApiKey };

/**
 * Builds a minimal mock SessionManager to avoid real Baileys connections.
 */
function buildMockSessionManager(overrides: Partial<SessionManager> = {}): SessionManager {
  const mock: Partial<SessionManager> = {
    getSessions: vi.fn(() => [] as WaSession[]),
    getSession: vi.fn(() => undefined),
    createSession: vi.fn(async (id: string) => ({
      id,
      socket: {} as any,
      status: 'pairing' as const,
      reconnectAttempts: 0,
    })),
    disconnectSession: vi.fn(async () => undefined),
    getQrCode: vi.fn(() => undefined),
    setEventHandlers: vi.fn(),
    initialize: vi.fn(async () => undefined),
    ...overrides,
  };
  return mock as SessionManager;
}

describe('GET /sessions', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty sessions list when no sessions are active', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('sessions');
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions).toHaveLength(0);
  });

  it('returns session list with active sessions', async () => {
    const mockSessions: WaSession[] = [
      {
        id: 'session-1',
        session_key: 'session-1',
        phone_number: '6281234567890',
        display_name: 'Test Account',
        status: 'connected',
        last_active_at: new Date().toISOString(),
      },
    ];

    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSessions: vi.fn(() => mockSessions),
      }),
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe('session-1');
    expect(body.sessions[0].status).toBe('connected');
  });
});

describe('POST /sessions/:id/disconnect', () => {
  it('returns 404 for non-existent session', async () => {
    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => undefined),
      }),
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/sessions/non-existent/disconnect',
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Not Found');

    await app.close();
  });

  it('disconnects an existing session and returns status', async () => {
    const disconnectSpy = vi.fn(async () => undefined);

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn((id) => ({
          id,
          socket: {} as any,
          status: 'connected' as const,
          reconnectAttempts: 0,
        })),
        disconnectSession: disconnectSpy,
      }),
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/sessions/my-session/disconnect',
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.session_id).toBe('my-session');
    expect(body.status).toBe('disconnected');
    expect(disconnectSpy).toHaveBeenCalledWith('my-session');

    await app.close();
  });
});

describe('GET /sessions/:id/qr (SSE)', () => {
  it('sends done event immediately if session is already connected', async () => {
    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn((id) => ({
          id,
          socket: {} as any,
          status: 'connected' as const,
          reconnectAttempts: 0,
        })),
        setEventHandlers: vi.fn(),
        getQrCode: vi.fn(() => undefined),
      }),
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/sessions/already-connected/qr',
      headers: AUTH_HEADERS,
    });

    // For a connected session the stream closes immediately
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('event: done');
    expect(res.payload).toContain('"status":"connected"');

    await app.close();
  });

  it('streams QR code event then done when onQrCode fires and session connects', async () => {
    let capturedHandlers: {
      onStatusChange?: (sessionId: string, status: string) => void;
      onQrCode?: (sessionId: string, qr: string) => void;
    } = {};

    const mockManager = buildMockSessionManager({
      getSession: vi.fn((id) => ({
        id,
        socket: {} as any,
        status: 'pairing' as const,
        reconnectAttempts: 0,
      })),
      getQrCode: vi.fn(() => undefined),
      setEventHandlers: vi.fn((handlers) => {
        capturedHandlers = handlers;
      }),
    });

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: mockManager,
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();

    // Start request (non-blocking) and trigger events after a tick
    const responsePromise = app.inject({
      method: 'GET',
      url: '/sessions/pairing-session/qr',
      headers: AUTH_HEADERS,
    });

    // Give the route handler time to set up event handlers
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate QR code arrival then connected status
    capturedHandlers.onQrCode?.('pairing-session', 'base64-qr-data');
    capturedHandlers.onStatusChange?.('pairing-session', 'connected');

    const res = await responsePromise;

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('event: qr');
    expect(res.payload).toContain('base64-qr-data');
    expect(res.payload).toContain('event: done');

    await app.close();
  });

  it('includes an existing pending QR code in the initial SSE payload', async () => {
    let capturedHandlers: {
      onStatusChange?: (sessionId: string, status: string) => void;
    } = {};

    const mockManager = buildMockSessionManager({
      getSession: vi.fn((id) => ({
        id,
        socket: {} as any,
        status: 'pairing' as const,
        qrCode: 'already-have-qr',
        reconnectAttempts: 0,
      })),
      getQrCode: vi.fn(() => 'already-have-qr'),
      setEventHandlers: vi.fn((handlers) => {
        capturedHandlers = handlers;
      }),
    });

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: mockManager,
      broadcastQueue: buildMockQueue(),
    });
    await app.ready();

    const responsePromise = app.inject({
      method: 'GET',
      url: '/sessions/pairing-session/qr',
      headers: AUTH_HEADERS,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Close the stream by simulating connection
    capturedHandlers.onStatusChange?.('pairing-session', 'connected');

    const res = await responsePromise;

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('event: qr');
    expect(res.payload).toContain('already-have-qr');

    await app.close();
  });
});
