import { describe, it, expect, beforeEach } from 'vitest';
import { limitRequests, __resetRateLimitStore, limits } from '../src/core/rate-limit.js';
import { TooManyRequestsError } from '../src/core/errors.js';
import { EventEmitter } from 'node:events';

interface FakeRequest {
  headers: Record<string, string | undefined>;
  ip: string;
  url: string;
  routeOptions?: { url?: string };
  raw: EventEmitter;
  principal: { tenantName: string } | null;
}

interface FakeReply {
  header: (name: string, value: string) => FakeReply;
  status: (code: number) => FakeReply;
  send: (body?: unknown) => unknown;
  raw: EventEmitter;
}

function makeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    headers: {},
    ip: '10.0.0.1',
    url: '/api/users/authenticate',
    routeOptions: { url: '/api/users/authenticate' },
    raw: new EventEmitter(),
    principal: null,
    ...overrides,
  };
}

function makeReply(): FakeReply & { headers: Record<string, string>; body: unknown } {
  const headers: Record<string, string> = {};
  return {
    headers,
    body: undefined,
    raw: new EventEmitter(),
    header(name, value) {
      headers[name] = value;
      return this;
    },
    status() {
      return this;
    },
    send(body) {
      this.body = body;
      return body;
    },
  };
}

/**
 * Runs one request through the limiter and flushes the response lifecycle.
 * `finish` is emitted on the *response* stream, so that is what is ticked here
 * — matching what `limitRequests` subscribes to.
 */
async function hit(hook: ReturnType<typeof limitRequests>, req = makeRequest()) {
  const reply = makeReply();
  await hook(req as never, reply as never);
  reply.raw.emit('finish');
  return reply;
}

describe('rate limiting', () => {
  beforeEach(() => __resetRateLimitStore());

  it('allows requests below the limit', async () => {
    const hook = limitRequests({ scope: 'ip', max: 3, windowSeconds: 60 });
    await hit(hook);
    await hit(hook);
    await hit(hook);
    expect(true).toBe(true);
  });

  it('rejects the request that exceeds the limit', async () => {
    const hook = limitRequests({ scope: 'ip', max: 3, windowSeconds: 60 });

    for (let i = 0; i < 3; i += 1) await hit(hook);

    const fourth = makeRequest();
    const reply = makeReply();
    await expect(hook(fourth as never, reply as never)).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('emits the standard rate limit headers', async () => {
    const hook = limitRequests({ scope: 'ip', max: 5, windowSeconds: 60 });
    const reply = await hit(hook);
    expect(reply.headers['X-RateLimit-Limit']).toBe('5');
    expect(reply.headers['X-RateLimit-Remaining']).toBe('5');
    expect(reply.headers['X-RateLimit-Reset']).toBeDefined();
  });

  it('keys the tenant bucket by tenant name, not by ip', async () => {
    const hook = limits.tenant();

    const a1 = makeRequest({ principal: { tenantName: 'alpha' } });
    await hit(hook, a1);
    const a2 = makeRequest({ principal: { tenantName: 'alpha' } });
    await hit(hook, a2);

    // A different tenant must not inherit the first tenant's counter.
    const b1 = makeRequest({ principal: { tenantName: 'beta' } });
    const reply = await hit(hook, b1);
    expect(reply.headers['X-RateLimit-Remaining']).toBe('300');
  });

  it('uses the custom demo payload instead of the standard error envelope', async () => {
    const hook = limits.demo();
    // The demo limit is one per day, so the very first call is already over it
    // once the previous call has been counted.
    await hit(hook);

    const req = makeRequest();
    const reply = makeReply();
    await hook(req as never, reply as never);

    // The demo endpoint answers with its own shape, consumed by the landing page.
    expect(reply.body).toMatchObject({ error: 'Rate limit exceeded', message: expect.any(String) });
  });
});