import type { Redis } from '../infra/redis.js';
import { SLIDING_WINDOW_SCRIPT } from './lua/sliding-window.lua.js';

/** `ratelimit:contact:{ipHash}`: one ZSET per limiter and sender; expires a window after use. */
export const rateLimitKey = (limiter: string, subject: string): string =>
  `ratelimit:${limiter}:${subject}`;

export interface SlidingWindowRequest {
  nowMs: number;
  windowMs: number;
  limit: number;
  /** Unique per request: two in the same millisecond are two members. */
  member: string;
}

export interface SlidingWindowResult {
  allowed: boolean;
  /** Requests still allowed in this window after this one. */
  remaining: number;
  /** When denied: until the oldest request leaves the window; 0 when allowed. */
  retryAfterMs: number;
}

/** The sliding-window script (dal/lua/sliding-window.lua.ts). */
export interface RateLimitDal {
  /** Records the request if the window has room, atomically. */
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
