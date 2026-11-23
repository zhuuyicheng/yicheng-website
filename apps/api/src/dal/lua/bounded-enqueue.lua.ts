import type { ClientContext, Result } from 'ioredis';

/**
 * "Append unless the buffer is full" in one atomic step (DESIGN.md §6.5): with LLEN then RPUSH,
 * two requests could both see room and overshoot the cap. Sent by SHA via `defineCommand`.
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

// Declares the command `defineCommand` adds at runtime.
declare module 'ioredis' {
  interface RedisCommander<Context extends ClientContext = { type: 'default' }> {
    /** 1 = appended, 0 = full. */
    telemetryBoundedEnqueue(
      bufferKey: string,
      maxLength: number,
      eventJson: string,
    ): Result<number, Context>;
  }
}
