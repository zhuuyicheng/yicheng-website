import type { onRequestAsyncHookHandler } from 'fastify';
import { AppError, ErrorCode } from '../errors/app-error.js';
import type { RateLimiterManager } from '../services/rate-limiter.manager.js';

/**
 * Rate-limits by client IP (DESIGN.md §6.4): `{ onRequest: rateLimit(limiter) }`. onRequest
 * runs before the body is parsed, so a blocked client costs one Redis call and can't probe the
 * validator. Headers are set first, so even a later 400 carries them.
 */
export function rateLimit(limiter: RateLimiterManager): onRequestAsyncHookHandler {
  return async (request, reply) => {
    const outcome = await limiter.consume(request.ip, request.log);

    void reply.header('x-ratelimit-limit', outcome.limit);
    void reply.header('x-ratelimit-remaining', outcome.remaining);
    void reply.header('x-ratelimit-window', outcome.windowSeconds);

    if (!outcome.allowed) {
      void reply.header('retry-after', outcome.retryAfterSeconds);
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        `Too many requests. Please retry in ${String(outcome.retryAfterSeconds)} seconds.`,
      );
    }
  };
}
