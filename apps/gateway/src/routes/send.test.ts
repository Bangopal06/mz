/**
 * Unit tests for the POST /send route (Task 11.6).
 * Requirements: 6.6, 11.7
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config/index.js';
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

const VALID_SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_TO = '6281234567890';
const VALID_MESSAGE = 'Hello, World!';

/** Creates a mock WASocket with a controllable sendMessage */
function buildMockSocket(sendMessageFn?: ReturnType<typeof vi.fn>) {
  return {
    sendMessage: sendMessageFn ?? vi.fn(async () => ({ key: { id: 'mock-msg-id-123' } })),
    user: { id: '628999@s.whatsapp.net', name: 'Test User' },
  } as any;
}

/** Builds a minimal mock SessionManager */
function buildMockSessionManager(overrides: Partial<SessionManager> = {}): SessionManager {
  const mock: Partial<SessionManager> = {
    getSessions: vi.fn(() => [] as WaSession[]),
    getSession: vi.fn(() => undefined),
    createSession: vi.fn(async (id: string) => ({
      id,
      socket: buildMockSocket(),
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

/** Builds a mock session info object with a given status */
function buildConnectedSession(sendMessageFn?: ReturnType<typeof vi.fn>) {
  return {
    id: VALID_SESSION_ID,
    socket: buildMockSocket(sendMessageFn),
    status: 'connected' as const,
    reconnectAttempts: 0,
    phoneNumber: '628999',
    displayName: 'Test Account',
  };
}

describe('POST /send — validation', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ session_id: VALID_SESSION_ID, to: VALID_TO, message: VALID_MESSAGE }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for invalid WA number format (no 62 prefix)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: '081234567890',
        message: VALID_MESSAGE,
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Validation Error');
  });

  it('returns 400 for empty message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: '',
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({ to: VALID_TO }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid session_id (not a UUID)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: 'not-a-uuid',
        to: VALID_TO,
        message: VALID_MESSAGE,
      }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /send — session errors', () => {
  it('returns 409 SESSION_NOT_FOUND when session does not exist', async () => {
    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => undefined),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
      }),
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.error_code).toBe('SESSION_NOT_FOUND');

    await app.close();
  });

  it('returns 409 SESSION_NOT_CONNECTED when session is disconnected', async () => {
    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => ({
          id: VALID_SESSION_ID,
          socket: buildMockSocket(),
          status: 'disconnected' as const,
          reconnectAttempts: 0,
        })),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
      }),
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.error_code).toBe('SESSION_NOT_CONNECTED');

    await app.close();
  });

  it('returns 409 SESSION_NOT_CONNECTED when session is in pairing state', async () => {
    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => ({
          id: VALID_SESSION_ID,
          socket: buildMockSocket(),
          status: 'pairing' as const,
          reconnectAttempts: 0,
        })),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
      }),
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.error_code).toBe('SESSION_NOT_CONNECTED');

    await app.close();
  });
});

describe('POST /send — text message', () => {
  it('returns 200 with message_id and status "sent" for text message', async () => {
    const sendMessage = vi.fn(async () => ({ key: { id: 'abc-msg-id-456' } }));

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => buildConnectedSession(sendMessage)),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.message_id).toBe('abc-msg-id-456');
    expect(body.to).toBe(VALID_TO);
    expect(body.status).toBe('sent');
    expect(body.timestamp).toBeDefined();

    // Verify sendMessage was called with correct JID and text payload
    expect(sendMessage).toHaveBeenCalledWith(
      `${VALID_TO}@s.whatsapp.net`,
      { text: VALID_MESSAGE }
    );

    await app.close();
  });

  it('returns 200 and generates a random message_id when socket returns no key', async () => {
    const sendMessage = vi.fn(async () => ({})); // No key returned

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => buildConnectedSession(sendMessage)),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.message_id).toBeTruthy(); // Fallback UUID was generated
    expect(body.status).toBe('sent');

    await app.close();
  });

  it('returns 502 SEND_FAILED when Baileys throws during send', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('Some Baileys internal error');
    });

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => buildConnectedSession(sendMessage)),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
      }),
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.payload);
    expect(body.error_code).toBe('SEND_FAILED');

    await app.close();
  });
});

describe('POST /send — media message', () => {
  it('calls sendMessage with image content for image MIME type', async () => {
    const fakeImageBuffer = Buffer.from('fake-image-data');
    const sendMessage = vi.fn(async () => ({ key: { id: 'img-msg-id-789' } }));

    // Mock fetch to simulate media download
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).startsWith('https://storage.example.com')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => fakeImageBuffer.buffer,
        } as Response;
      }
      // Supabase activity update call — return minimal ok response
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as any;

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => buildConnectedSession(sendMessage)),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
        media: {
          url: 'https://storage.example.com/test-image.jpg',
          mime_type: 'image/jpeg',
          caption: 'Test caption',
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.message_id).toBe('img-msg-id-789');
    expect(body.status).toBe('sent');

    // Verify sendMessage was called with image content
    expect(sendMessage).toHaveBeenCalledOnce();
    const [jid, content] = sendMessage.mock.calls[0];
    expect(jid).toBe(`${VALID_TO}@s.whatsapp.net`);
    expect(content).toMatchObject({
      image: expect.any(Buffer),
      mimetype: 'image/jpeg',
      caption: 'Test caption',
    });

    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('calls sendMessage with video content for video MIME type', async () => {
    const fakeVideoBuffer = Buffer.from('fake-video-data');
    const sendMessage = vi.fn(async () => ({ key: { id: 'vid-msg-id-001' } }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).startsWith('https://storage.example.com')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => fakeVideoBuffer.buffer,
        } as Response;
      }
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as any;

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => buildConnectedSession(sendMessage)),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
        media: {
          url: 'https://storage.example.com/test-video.mp4',
          mime_type: 'video/mp4',
        },
      }),
    });

    expect(res.statusCode).toBe(200);

    const [, content] = sendMessage.mock.calls[0];
    expect(content).toMatchObject({
      video: expect.any(Buffer),
      mimetype: 'video/mp4',
    });

    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('calls sendMessage with document content for PDF MIME type', async () => {
    const fakePdfBuffer = Buffer.from('fake-pdf-data');
    const sendMessage = vi.fn(async () => ({ key: { id: 'pdf-msg-id-002' } }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).startsWith('https://storage.example.com')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => fakePdfBuffer.buffer,
        } as Response;
      }
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as any;

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => buildConnectedSession(sendMessage)),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
        media: {
          url: 'https://storage.example.com/test-doc.pdf',
          mime_type: 'application/pdf',
          caption: 'Invoice PDF',
        },
      }),
    });

    expect(res.statusCode).toBe(200);

    const [, content] = sendMessage.mock.calls[0];
    expect(content).toMatchObject({
      document: expect.any(Buffer),
      mimetype: 'application/pdf',
      caption: 'Invoice PDF',
    });

    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('returns 502 MEDIA_DOWNLOAD_FAILED when media URL returns non-200', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response)) as any;

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => buildConnectedSession()),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
        media: {
          url: 'https://storage.example.com/missing-file.jpg',
          mime_type: 'image/jpeg',
        },
      }),
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.payload);
    expect(body.error_code).toBe('MEDIA_DOWNLOAD_FAILED');

    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('returns 502 MEDIA_DOWNLOAD_FAILED when fetch throws a network error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED: connection refused');
    }) as any;

    const app = await buildApp({
      logger: false,
      config: testConfig,
      sessionManager: buildMockSessionManager({
        getSession: vi.fn(() => buildConnectedSession()),
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: AUTH_HEADERS,
      payload: JSON.stringify({
        session_id: VALID_SESSION_ID,
        to: VALID_TO,
        message: VALID_MESSAGE,
        media: {
          url: 'https://storage.example.com/image.jpg',
          mime_type: 'image/jpeg',
        },
      }),
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.payload);
    expect(body.error_code).toBe('MEDIA_DOWNLOAD_FAILED');

    globalThis.fetch = originalFetch;
    await app.close();
  });
});
