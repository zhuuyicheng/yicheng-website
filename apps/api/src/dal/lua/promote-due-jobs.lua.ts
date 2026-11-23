import type { ClientContext, Result } from 'ioredis';

/**
 * Moves due retries from `delayed` (scored by run time) to `ready` in one atomic step, so a
 * crash between ZREM and LPUSH can't lose a job (DESIGN.md §6.6). Runs every second.
 */
export const PROMOTE_DUE_JOBS_SCRIPT = {
  name: 'notificationsPromoteDue',
  numberOfKeys: 2,
  lua: `
-- KEYS[1] jobs:notifications:delayed   KEYS[2] jobs:notifications:ready
-- ARGV[1] now (ms)   ARGV[2] max jobs to move
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, job in ipairs(due) do
  redis.call('ZREM', KEYS[1], job)
  redis.call('LPUSH', KEYS[2], job)
end
return #due
`,
} as const;

// Declares the command `defineCommand` adds at runtime.
declare module 'ioredis' {
  interface RedisCommander<Context extends ClientContext = { type: 'default' }> {
    /** How many jobs moved to the ready list. */
    notificationsPromoteDue(
      delayedKey: string,
      readyKey: string,
      nowMs: number,
      maxJobs: number,
    ): Result<number, Context>;
  }
}
