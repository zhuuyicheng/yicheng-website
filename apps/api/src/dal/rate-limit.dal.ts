import type { Redis } from '../infra/redis.js';
import { SLIDING_WINDOW_SCRIPT } from './lua/sliding-window.lua.js';

/**
 * `ratelimit:contact:{ipHash}`: one sorted set per limiter and sender (DESIGN.md §6.2).
 * Ephemeral: each key expires one window after its last accepted request.
 */
export const rateLimitKey = (limiter: string, subject: string): string =>
  `ratelimit:${limiter}:${subject}`;

export interface SlidingWindowRequest {
  nowMs: number;
  windowMs: number;
  limit: number;
  /** Unique per request: two requests in the same millisecond must be two members. */
  member: string;
}

export interface SlidingWindowResult {
  allowed: boolean;
  /** Requests still allowed in the current window after this one. */
  remaining: number;
  /** When denied: how long until the oldest request leaves the window. 0 when allowed. */
  retryAfterMs: number;
}

/** Redis DAL for rate limiting: the sliding-window script (dal/lua/sliding-window.lua.ts). */
export interface RateLimitDal {
  /** Records the request if the window has room, in one atomic step. */
  consume: (key: string, request: SlidingWindowRequest) => Promise<SlidingWindowResult>;
}

export function createRateLimitDal(redis: Redis): RateLimitDal {
  redis.defineCommand(SLIDING_WINDOW_SCRIPT.name, {
    numberOfKeys: SLIDING_WINDOW_SCRIPT.numberOfKeys,
    lua: SLIDING_WINDOW_SCRIPT.lua,
  });

  return {
    async consume(key, { nowMs, windowMs, limit, member }) {
      const [allowed, remaining, retryAfterMs] = await redis.rateLimitSlidingWindow(
        key,
        nowMs,
        windowMs,
        limit,
        member,
      );
      return { allowed: allowed === 1, remaining, retryAfterMs };
    },
  };
}
