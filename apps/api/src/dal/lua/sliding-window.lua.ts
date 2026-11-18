import type { ClientContext, Result } from 'ioredis';

/**
 * Sliding-window rate limiter, as ONE atomic step. See DESIGN.md §6.4.
 *
 * The key is a sorted set (ZSET) holding one member per ACCEPTED request, scored by its time
 * in ms. A request is allowed if fewer than `limit` members are newer than `now − window`.
 * Rejected requests are not recorded, so a client that keeps retrying while blocked does not
 * extend its own lockout.
 *
 * Why a script: as separate commands (count, then add), 20 simultaneous requests could all
 * count 0 and all be admitted. Redis runs a script without interleaving any other command, so
 * exactly `limit` of them get in, even across several API processes.
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

// Tells TypeScript about the command that `defineCommand` adds to the client at runtime.
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
