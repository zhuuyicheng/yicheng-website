import type { ClientContext, Result } from 'ioredis';

/**
 * Sliding-window rate limit in one atomic step (DESIGN.md §6.4). A ZSET holds one member per
 * accepted request, scored by time; refused ones aren't recorded, so retrying while blocked
 * doesn't extend the block. Atomic, so simultaneous requests can't all slip in.
 */
export const SLIDING_WINDOW_SCRIPT = {
  name: 'rateLimitSlidingWindow',
  numberOfKeys: 1,
  lua: `
-- KEYS[1] ratelimit:{limiter}:{subject}
-- ARGV[1] now (ms)   ARGV[2] window (ms)   ARGV[3] limit   ARGV[4] unique member for this request
-- Returns { allowed (1|0), remaining, retryAfterMs }
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)   -- forget requests older than the window
local used = redis.call('ZCARD', key)

if used < limit then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, window)                        -- gone one window after the last request
  return { 1, limit - used - 1, 0 }
end

-- Full: the oldest request leaves the window first, and frees a slot when it does.
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
return { 0, 0, tonumber(oldest[2]) + window - now }
`,
} as const;

// Declares the command `defineCommand` adds at runtime.
declare module 'ioredis' {
  interface RedisCommander<Context extends ClientContext = { type: 'default' }> {
    /** `[allowed (1|0), remaining, retryAfterMs]`. */
    rateLimitSlidingWindow(
      key: string,
      nowMs: number,
      windowMs: number,
      limit: number,
      member: string,
    ): Result<[number, number, number], Context>;
  }
}
