import type { onRequestAsyncHookHandler } from 'fastify';
import { AppError, ErrorCode } from '../errors/app-error.js';
import type { RateLimiterManager } from '../services/rate-limiter.manager.js';

/**
 * A route hook that rate-limits by client IP (DESIGN.md §6.4, §7.6). Attach it to a route
 * with `{ onRequest: rateLimit(limiter) }`.
 *
 * Why `onRequest`: it is the first hook Fastify runs, before the body is read and parsed.
 * A blocked client costs one Redis call and nothing else, and the request is counted before
 * validation, so a bot cannot probe the validator for free.
 *
 * The headers are set before anything can fail, so they are on every response from the route,
 * including a 400 from validation later on.
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
