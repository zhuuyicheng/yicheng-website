import { randomUUID } from 'node:crypto';
import { rateLimitKey, type RateLimitDal } from '../dal/rate-limit.dal.js';
import { AppError, ErrorCode } from '../errors/app-error.js';
import type { IpHasher } from '../infra/ip-hash.js';
import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';

/** Everything a caller needs to answer the request and fill in the `X-RateLimit-*` headers. */
export interface RateLimitOutcome {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** The window `limit` counts over, so a client can say "3 messages every 10 minutes". */
  windowSeconds: number;
  /** When denied: whole seconds until a retry can succeed (rounded up). 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * "At most `max` requests per sender per `windowSeconds`" (DESIGN.md §6.4). The counting
 * happens atomically in Redis, so the limit holds across every API process.
 */
export interface RateLimiterManager {
  /**
   * Counts one request from `ip` if the window has room. Fails closed: when Redis is
   * unavailable it throws a 503 instead of letting every request through.
   */
  consume: (ip: string, log: Logger) => Promise<RateLimitOutcome>;
}

export interface RateLimiterManagerDependencies {
  /** Names the limiter in Redis keys and metric labels, e.g. `contact`. */
  limiter: string;
  rateLimitDal: RateLimitDal;
  hashIp: IpHasher;
  metrics: Metrics;
  max: number;
  windowSeconds: number;
  /** Injectable for tests. */
  now?: () => number;
  newMemberId?: () => string;
}

export function createRateLimiterManager(deps: RateLimiterManagerDependencies): RateLimiterManager {
  const { limiter, rateLimitDal, hashIp, metrics, max, windowSeconds } = deps;
  const { now = Date.now, newMemberId = randomUUID } = deps;

  return {
    async consume(ip, log) {
      // The key holds a hash, never the IP itself: Redis data and its backups stay IP-free.
      const key = rateLimitKey(limiter, hashIp(ip));
      const nowMs = now();

      let window;
      try {
        window = await rateLimitDal.consume(key, {
          nowMs,
          windowMs: windowSeconds * 1000,
          limit: max,
          member: `${String(nowMs)}-${newMemberId()}`,
        });
      } catch (error) {
        if (!isTransientDatastoreError(error)) {
          throw error; // a bug, not an outage: let it surface as a 500
        }
        // Fail closed: without Redis we cannot count, and an open contact form would let a
        // bot flood the inbox. The form is not critical; a short outage is acceptable.
        metrics.rateLimitErrors.inc({ limiter });
        log.warn({ err: error, limiter }, 'rate limiter unavailable, refusing request');
        throw new AppError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'This service is temporarily unavailable. Please retry shortly.',
          { cause: error },
        );
      }

      metrics.rateLimitDecisions.inc({ limiter, decision: window.allowed ? 'allowed' : 'denied' });
      return {
        allowed: window.allowed,
        limit: max,
        remaining: window.remaining,
        windowSeconds,
        // Rounded up: retrying after a rounded-down value could arrive a moment too early.
        retryAfterSeconds: window.allowed ? 0 : Math.max(1, Math.ceil(window.retryAfterMs / 1000)),
      };
    },
  };
}
