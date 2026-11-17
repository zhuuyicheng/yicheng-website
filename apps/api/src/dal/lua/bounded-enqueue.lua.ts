import type { ClientContext, Result } from 'ioredis';

/**
 * "Append to the buffer unless it is full", as ONE atomic step. See DESIGN.md §6.5.
 *
 * Why a script: as two separate commands (LLEN, then RPUSH), two API requests could both read
 * 99 999 and both push, overshooting the cap. Redis runs a Lua script start to finish without
 * running any other command in between, so the check and the push cannot be interleaved.
 *
 * Registered with ioredis `defineCommand` (in event-buffer.dal.ts): ioredis sends the script's
 * SHA-1 hash with EVALSHA, and only sends the full source again if Redis replies NOSCRIPT
 * (e.g. after a Redis restart).
 */
export const BOUNDED_ENQUEUE_SCRIPT = {
  name: 'telemetryBoundedEnqueue',
  numberOfKeys: 1,
  lua: `
-- KEYS[1] telemetry:events:buffer   ARGV[1] max length   ARGV[2] event JSON
if redis.call('LLEN', KEYS[1]) >= tonumber(ARGV[1]) then
  return 0                      -- buffer full: the caller answers 503
end
redis.call('RPUSH', KEYS[1], ARGV[2])
return 1
`,
} as const;

// Tells TypeScript about the command that `defineCommand` adds to the client at runtime.
declare module 'ioredis' {
  interface RedisCommander<Context extends ClientContext = { type: 'default' }> {
    /** 1 = appended, 0 = the buffer already holds `maxLength` events. */
    telemetryBoundedEnqueue(
      bufferKey: string,
      maxLength: number,
      eventJson: string,
    ): Result<number, Context>;
  }
}
