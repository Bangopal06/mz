/**
 * Unit tests for broadcast-processor.ts
 *
 * Covers:
 *  - Task 12.1: BullMQ queue processor — fetch recipients, send, rate limit
 *  - Task 12.3: Resume from last_sent_index (skip already-sent recipients)
 *  - Task 12.5: Per-message retry logic (3 attempts, delays 0 / 5s / 15s)
 *
 * Requirements: 6.5, 6.6, 6.8, 10.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { processBroadcastJob, randomDelay } from './broadcast-processor.js';
import type { BroadcastJobData } from './index.js';
import type { SessionManager } from '../whatsapp/session-manager.js';
import type { SessionInfo } from '../whatsapp/session-manager.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockJob(data: BroadcastJobData): Job<BroadcastJobData> {
  return { id: 'job-1', data } as unknown as Job<BroadcastJobData>;
}

function makeMockSessionManager(
  overrides: Partial<{ getSession: () => SessionInfo | undefined }>
): SessionManager {
  return {
    getSession: overrides.getSession ?? vi.fn(() => undefined),
    getSessions: vi.fn(),
    createSession: vi.fn(),
    disconnectSession: vi.fn(),
    getQrCode: vi.fn(),
    setEventHandlers: vi.fn(),
    initialize: vi.fn(),
  } as unknown as SessionManager;
}

function makeConnectedSession(sendMessageFn?: (...args: unknown[]) => unknown): SessionInfo {
  return {
    id: 'session-1',
    socket: {
      sendMessage: sendMessageFn ?? vi.fn().mockResolvedValue({ key: { id: 'msg-1' } }),
    } as unknown as SessionInfo['socket'],
    status: 'connected',
    reconnectAttempts: 0,
  };
}

/** Returns a minimal fetch mock that handles all necessary Supabase REST calls */
function buildFetchMock(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    broadcastJob: {
      id: 'broadcast-1',
      message_body: 'Hello {{nama}}!',
      attachment_id: null,
      wa_session_id: 'session-1',
      status: 'running',
      last_sent_index: 0,
      total_recipients: 2,
      rate_limit_min_ms: 100,
      rate_limit_max_ms: 200,
    },
    recipients: [
      {
        id: 'r1',
        broadcast_id: 'broadcast-1',
        contact_id: 'c1',
        send_order: 1,
        contacts: { full_name: 'Alice', wa_number: '628111111111' },
      },
      {
        id: 'r2',
        broadcast_id: 'broadcast-1',
        contact_id: 'c2',
        send_order: 2,
        contacts: { full_name: 'Bob', wa_number: '628222222222' },
      },
    ],
    progress: [{ sent_count: 0, failed_count: 0 }],
    ...overrides,
  };

  return vi.fn((url: string, opts?: RequestInit) => {
    // broadcast_jobs GET (single row)
    if (
      url.includes('/rest/v1/broadcast_jobs') &&
      url.includes('id=eq.broadcast-1') &&
      url.includes('select=id,message_body') &&
      (!opts || opts.method === undefined || opts.method === 'GET')
    ) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([defaults.broadcastJob]),
      });
    }

    // broadcast_jobs GET for sent_count / failed_count (progress read)
    if (
      url.includes('/rest/v1/broadcast_jobs') &&
      url.includes('select=sent_count,failed_count')
    ) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(defaults.progress),
      });
    }

    // broadcast_jobs PATCH
    if (url.includes('/rest/v1/broadcast_jobs') && opts?.method === 'PATCH') {
      return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
    }

    // broadcast_recipients GET
    if (url.includes('/rest/v1/broadcast_recipients')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(defaults.recipients),
      });
    }

    // message_logs POST (upsert)
    if (url.includes('/rest/v1/message_logs')) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
    }

    // fallback
    return Promise.resolve({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    });
  });
}

// ── randomDelay ────────────────────────────────────────────────────────────────

describe('randomDelay', () => {
  it('returns a value within [min, max]', () => {
    for (let i = 0; i < 100; i++) {
      const delay = randomDelay(100, 200);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(200);
    }
  });

  it('returns exactly min when min === max', () => {
    for (let i = 0; i < 20; i++) {
      expect(randomDelay(500, 500)).toBe(500);
    }
  });
});

// ── processBroadcastJob ────────────────────────────────────────────────────────

describe('processBroadcastJob', () => {
  let mockFetch: ReturnType<typeof buildFetchMock>;
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let sessionManager: SessionManager;

  beforeEach(() => {
    sendMessageSpy = vi.fn().mockResolvedValue({ key: { id: 'msg-1' } });
    sessionManager = makeMockSessionManager({
      getSession: () => makeConnectedSession(sendMessageSpy),
    });
  });

  it('sends messages to all recipients and marks broadcast completed', async () => {
    mockFetch = buildFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    await processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      }),
      {
        sessionManager,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );

    // sendMessage called twice (one per recipient)
    expect(sendMessageSpy).toHaveBeenCalledTimes(2);

    // Check that message was personalized with contact name
    const firstCall = sendMessageSpy.mock.calls[0];
    expect(firstCall[1]).toMatchObject({ text: 'Hello Alice!' });

    const secondCall = sendMessageSpy.mock.calls[1];
    expect(secondCall[1]).toMatchObject({ text: 'Hello Bob!' });

    vi.unstubAllGlobals();
  });

  it('skips recipients with send_order <= last_sent_index (resume logic, Req 6.8)', async () => {
    // Simulate last_sent_index=1, so only send_order > 1 recipients remain
    mockFetch = buildFetchMock({
      broadcastJob: {
        id: 'broadcast-1',
        message_body: 'Hi {{nama}}',
        attachment_id: null,
        wa_session_id: 'session-1',
        status: 'paused',
        last_sent_index: 1,
        total_recipients: 2,
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      },
      // Only send_order=2 (Bob) should be returned since send_order > 1
      recipients: [
        {
          id: 'r2',
          broadcast_id: 'broadcast-1',
          contact_id: 'c2',
          send_order: 2,
          contacts: { full_name: 'Bob', wa_number: '628222222222' },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    await processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      }),
      {
        sessionManager,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );

    // Only Bob (send_order=2) should be processed
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy.mock.calls[0][1]).toMatchObject({ text: 'Hi Bob' });

    // Verify the query passed send_order=gt.1 — check the fetch call URL
    const recipientCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes('/rest/v1/broadcast_recipients')
    );
    expect(recipientCall).toBeDefined();
    expect(recipientCall![0]).toContain('send_order=gt.1');

    vi.unstubAllGlobals();
  });

  it('pauses broadcast when session disconnects mid-processing', async () => {
    let callCount = 0;
    const disconnectedAfterFirst = makeMockSessionManager({
      getSession: () => {
        callCount++;
        if (callCount <= 2) {
          // First check: connected (job start + first recipient)
          return makeConnectedSession(sendMessageSpy);
        }
        // Second recipient check: disconnected
        return { ...makeConnectedSession(sendMessageSpy), status: 'disconnected' } as SessionInfo;
      },
    });

    mockFetch = buildFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    await processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      }),
      {
        sessionManager: disconnectedAfterFirst,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );

    // Only Alice sent; Bob's send was blocked by disconnection
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);

    // Broadcast should be paused (status=paused PATCH)
    const patchCalls = mockFetch.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes('/rest/v1/broadcast_jobs') && opts?.method === 'PATCH'
    );
    const pausedCall = patchCalls.find(([, opts]: [string, RequestInit?]) => {
      const body = JSON.parse(opts?.body as string);
      return body.status === 'paused';
    });
    expect(pausedCall).toBeDefined();

    vi.unstubAllGlobals();
  });

  it('marks broadcast cancelled when status=cancelled in DB', async () => {
    mockFetch = buildFetchMock({
      broadcastJob: {
        id: 'broadcast-1',
        message_body: 'Hi',
        attachment_id: null,
        wa_session_id: 'session-1',
        status: 'cancelled',
        last_sent_index: 0,
        total_recipients: 2,
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      },
    });
    vi.stubGlobal('fetch', mockFetch);

    await processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      }),
      {
        sessionManager,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );

    // Should not attempt to send any messages
    expect(sendMessageSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('retries failed sends up to 3 attempts then marks message as failed (Req 6.6, 10.4)', async () => {
    // sendMessage always throws
    const alwaysFailingSend = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Network error'), { code: 'SEND_FAILED' }));

    const failingSessionManager = makeMockSessionManager({
      getSession: () => makeConnectedSession(alwaysFailingSend),
    });

    mockFetch = buildFetchMock({
      recipients: [
        {
          id: 'r1',
          broadcast_id: 'broadcast-1',
          contact_id: 'c1',
          send_order: 1,
          contacts: { full_name: 'Alice', wa_number: '628111111111' },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    // Use minimal delays to keep test fast (override via job data)
    vi.useFakeTimers();

    const jobPromise = processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      }),
      {
        sessionManager: failingSessionManager,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );

    // Advance timers past retry delays (5s + 15s)
    await vi.runAllTimersAsync();
    await jobPromise;

    vi.useRealTimers();

    // sendMessage should have been called 3 times (3 attempts)
    expect(alwaysFailingSend).toHaveBeenCalledTimes(3);

    // message_logs upsert should record status=failed
    const logCall = mockFetch.mock.calls.find(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes('/rest/v1/message_logs') && opts?.method === 'POST'
    );
    expect(logCall).toBeDefined();
    const logBody = JSON.parse(logCall![1]!.body as string);
    expect(logBody.status).toBe('failed');
    expect(logBody.error_code).toBe('SEND_FAILED');

    vi.unstubAllGlobals();
  });

  it('updates last_sent_index after each successful send (Req 6.8)', async () => {
    mockFetch = buildFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    await processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      }),
      {
        sessionManager,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );

    // Find the progress PATCH calls (updateBroadcastProgress)
    const patchCalls = mockFetch.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes('/rest/v1/broadcast_jobs') &&
        url.includes('select=sent_count') === false &&
        opts?.method === 'PATCH'
    );

    // Should have PATCH calls that update last_sent_index
    const progressPatches = patchCalls.filter(([, opts]: [string, RequestInit?]) => {
      try {
        const body = JSON.parse(opts?.body as string);
        return body.last_sent_index !== undefined && body.status === undefined;
      } catch {
        return false;
      }
    });

    expect(progressPatches.length).toBeGreaterThanOrEqual(1);

    // First progress patch should set last_sent_index=1 (send_order of first recipient)
    const firstPatch = progressPatches[0];
    const firstBody = JSON.parse(firstPatch[1].body as string);
    expect(firstBody.last_sent_index).toBe(1);

    vi.unstubAllGlobals();
  });

  it('marks broadcast as completed when all recipients are processed', async () => {
    mockFetch = buildFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    await processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      }),
      {
        sessionManager,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );

    // Find the status=completed PATCH
    const patchCalls = mockFetch.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes('/rest/v1/broadcast_jobs') && opts?.method === 'PATCH'
    );
    const completedPatch = patchCalls.find(([, opts]: [string, RequestInit?]) => {
      try {
        const body = JSON.parse(opts?.body as string);
        return body.status === 'completed';
      } catch {
        return false;
      }
    });
    expect(completedPatch).toBeDefined();

    vi.unstubAllGlobals();
  });

  it('applies rate limit delay between messages (Req 6.5)', async () => {
    mockFetch = buildFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 500,
        rate_limit_max_ms: 1000,
      }),
      {
        sessionManager,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );

    // At least one rate-limit sleep should have been applied between the 2 messages
    const rateLimitCalls = setTimeoutSpy.mock.calls.filter(([, delay]) => {
      const d = delay as number;
      return d >= 500 && d <= 1000;
    });
    expect(rateLimitCalls.length).toBeGreaterThanOrEqual(1);

    setTimeoutSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('logs error_code and error_message to message_logs on failure (Req 10.4)', async () => {
    const failingSend = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('invalid jid'), { code: 'INVALID_RECIPIENT' }));

    const failingSessionManager = makeMockSessionManager({
      getSession: () => makeConnectedSession(failingSend),
    });

    mockFetch = buildFetchMock({
      recipients: [
        {
          id: 'r1',
          broadcast_id: 'broadcast-1',
          contact_id: 'c1',
          send_order: 1,
          contacts: { full_name: 'Alice', wa_number: '628111111111' },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    vi.useFakeTimers();
    const jobPromise = processBroadcastJob(
      makeMockJob({
        broadcast_id: 'broadcast-1',
        session_id: 'session-1',
        rate_limit_min_ms: 0,
        rate_limit_max_ms: 0,
      }),
      {
        sessionManager: failingSessionManager,
        supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'key' },
      }
    );
    await vi.runAllTimersAsync();
    await jobPromise;
    vi.useRealTimers();

    const logCall = mockFetch.mock.calls.find(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes('/rest/v1/message_logs') && opts?.method === 'POST'
    );
    expect(logCall).toBeDefined();
    const logBody = JSON.parse(logCall![1]!.body as string);
    expect(logBody.error_code).toBe('INVALID_RECIPIENT');
    expect(logBody.error_message).toBe('invalid jid');

    vi.unstubAllGlobals();
  });
});
