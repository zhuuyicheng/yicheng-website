import { randomUUID } from 'node:crypto';
import { rateLimitKey, type RateLimitDal } from '../dal/rate-limit.dal.js';
import { AppError, ErrorCode } from '../errors/app-error.js';
import type { IpHasher } from '../infra/ip-hash.js';
import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';

/** What a caller needs to answer and fill in the `X-RateLimit-*` headers. */
export interface RateLimitOutcome {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** The window `limit` counts over ("3 messages every 10 minutes"). */
  windowSeconds: number;
  /** When denied: whole seconds until a retry can succeed; 0 when allowed. */
  retryAfterSeconds: number;
}

/** At most `max` requests per sender per window (DESIGN.md §6.4), counted atomically in Redis. */
export interface RateLimiterManager {
  /** Counts one request if the window has room. Fails closed: no Redis → 503, not "allow all". */
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
  /** For tests. */
  now?: () => number;
  newMemberId?: () => string;
}

export function createRateLimiterManager(deps: RateLimiterManagerDependencies): RateLimiterManager {
  const { limiter, rateLimitDal, hashIp, metrics, max, windowSeconds } = deps;
  const { now = Date.now, newMemberId = randomUUID } = deps;

  return {
    async consume(ip, log) {
      // A hash, never the IP: Redis and its backups stay IP-free.
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
          throw error; // a bug, not an outage: a 500
        }
        // Fail closed: without counting, a bot could flood the inbox. A short form outage is fine.
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
        // Rounded up, or a retry could come a moment too early.
        retryAfterSeconds: window.allowed ? 0 : Math.max(1, Math.ceil(window.retryAfterMs / 1000)),
      };
    },
  };
}
