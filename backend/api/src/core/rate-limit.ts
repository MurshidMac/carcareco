import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { TooManyRequestsError } from '../core/errors.js';

/**
 * Port of `Carmasters.Core.Application.RateLimiting`.
 *
 * Fixed-window counter, keyed exactly as the .NET strategies key it:
 *   standard -> `{path}_{ip}`
 *   tenant   -> `{path}_{method}_{tenantName}`, falling back to `{path}_{ip}`
 *   demo     -> `demo_rate_limit_{ip}`
 *
 * The .NET backend backed this with `IDistributedMemoryCache`, so counters are
 * per-process. This is equally per-process; swap `store` for Redis if the API
 * is scaled to multiple instances.
 */

interface Bucket {
  count: number;
  /** Epoch ms at which the current window was last refreshed. */
  lastWindowStart: number;
}

const store = new Map<string, Bucket>();

// Bound memory: drop expired buckets opportunistically.
const sweep = setInterval(() => {
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (const [key, bucket] of store) {
    if (bucket.lastWindowStart < cutoff) store.delete(key);
  }
}, 10 * 60 * 1000);
sweep.unref();

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? request.ip ?? 'unknown').trim();
}

export type LimitScope = 'tenant' | 'ip' | 'demo';

export interface LimitSpec {
  scope: LimitScope;
  max: number;
  windowSeconds: number;
  /** Overrides the standard 429 body. The demo endpoint has a custom shape. */
  message?: string;
}

function keyFor(request: FastifyRequest, spec: LimitSpec): string {
  switch (spec.scope) {
    case 'demo':
      return `demo_rate_limit_${clientIp(request)}`;
    case 'tenant': {
      const tenant = request.principal?.tenantName;
      return tenant
        ? `${request.routeOptions?.url ?? request.url}_${request.method}_${tenant}`
        : `${request.routeOptions?.url ?? request.url}_${clientIp(request)}`;
    }
    case 'ip':
    default:
      return `${request.routeOptions?.url ?? request.url}_${clientIp(request)}`;
  }
}

/**
 * Returns a `preHandler` hook implementing the limit.
 *
 * Mirrors `RateLimitingMiddleware`: reject before processing, emit
 * `X-RateLimit-*` headers, then increment only after the handler succeeds.
 */
export function limitRequests(spec: LimitSpec) {
  return async function rateLimitHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = keyFor(request, spec);
    const windowMs = spec.windowSeconds * 1000;
    const now = Date.now();

    const existing = store.get(key);
    const inWindow = existing !== undefined && now - existing.lastWindowStart < windowMs;

    if (inWindow && existing.count >= spec.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.lastWindowStart + windowMs - now) / 1000),
      );
      if (spec.scope === 'demo') {
        // Shape consumed by `frontend/src/app/page.tsx`.
        const hours = Math.floor(retryAfterSeconds / 3600);
        const minutes = Math.floor((retryAfterSeconds % 3600) / 60);
        reply.status(429).send({
          error: 'Rate limit exceeded',
          message:
            spec.message ??
            `You can only create one demo instance per day. Please try again in ${hours} hours and ${minutes} minutes.`,
          retryAfter: retryAfterSeconds,
        });
        return;
      }
      throw new TooManyRequestsError(spec.message ?? 'Rate limit exceeded.', retryAfterSeconds);
    }

    const used = inWindow ? existing.count : 0;
    reply.header('X-RateLimit-Limit', String(spec.max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, spec.max - used)));
    reply.header('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

    // The .NET middleware updated statistics only after the pipeline ran, so
    // failed requests never counted towards the limit.
    request.raw.on('finish', () => {
      const current = store.get(key);
      if (current && now - current.lastWindowStart < windowMs && current.count < spec.max) {
        current.count += 1;
      } else {
        store.set(key, { count: 1, lastWindowStart: now });
      }
    });
  };
}

export const limits = {
  tenant: (): ReturnType<typeof limitRequests> =>
    limitRequests({
      scope: 'tenant',
      max: config.rateLimit.tenant.max,
      windowSeconds: config.rateLimit.tenant.windowSeconds,
    }),
  login: (): ReturnType<typeof limitRequests> =>
    limitRequests({
      scope: 'ip',
      max: config.rateLimit.login.max,
      windowSeconds: config.rateLimit.login.windowSeconds,
      message: 'Too many login attempts. Please try again later.',
    }),
  profilePicture: (): ReturnType<typeof limitRequests> =>
    limitRequests({
      scope: 'ip',
      max: config.rateLimit.picture.max,
      windowSeconds: config.rateLimit.picture.windowSeconds,
    }),
  demo: (): ReturnType<typeof limitRequests> =>
    limitRequests({
      scope: 'demo',
      max: config.rateLimit.demo.max,
      windowSeconds: config.rateLimit.demo.windowSeconds,
    }),
};

/** Test seam. */
export function __resetRateLimitStore(): void {
  store.clear();
}
