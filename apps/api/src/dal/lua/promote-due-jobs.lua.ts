import type { ClientContext, Result } from 'ioredis';

/**
 * "Move every retry whose wait is over from `delayed` to `ready`", as ONE atomic step.
 * See DESIGN.md §6.6. The worker's promoter runs it every second.
 *
 * `delayed` is a sorted set scored by the time (ms) a job may run again, so the due jobs are
 * simply the lowest scores up to now. Why a script: as separate commands, a crash between the
 * ZREM and the LPUSH would lose the job.
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

// Tells TypeScript about the command that `defineCommand` adds to the client at runtime.
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
