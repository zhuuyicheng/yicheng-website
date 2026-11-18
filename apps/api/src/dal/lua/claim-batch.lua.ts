import type { ClientContext, Result } from 'ioredis';

/**
 * "Take the next batch off the buffer, but keep a copy until it is safely in Postgres", as ONE
 * atomic step. See DESIGN.md §6.5.
 *
 * The batch moves from `telemetry:events:buffer` to `telemetry:events:inflight`. Only after
 * the Postgres insert commits does the flusher delete the in-flight list (the acknowledgement).
 * If the worker crashes or the insert fails in between, the batch is still in the in-flight
 * list, and the next claim returns it again instead of a new one: nothing is lost.
 *
 * Why a script: as separate commands, a crash between "remove from buffer" and "add to
 * in-flight" would lose the batch. Redis runs a script without interleaving other commands.
 */
export const CLAIM_BATCH_SCRIPT = {
  name: 'telemetryClaimBatch',
  numberOfKeys: 2,
  lua: `
-- KEYS[1] telemetry:events:buffer   KEYS[2] telemetry:events:inflight   ARGV[1] batch size
local inflight = redis.call('LRANGE', KEYS[2], 0, -1)
if #inflight > 0 then
  return inflight               -- an unacknowledged batch (crash or failed insert): retry it
end
local batch = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1)
if #batch == 0 then
  return batch                  -- nothing to do
end
redis.call('LTRIM', KEYS[1], #batch, -1)
redis.call('RPUSH', KEYS[2], unpack(batch))
return batch
`,
} as const;

// Tells TypeScript about the command that `defineCommand` adds to the client at runtime.
declare module 'ioredis' {
  interface RedisCommander<Context extends ClientContext = { type: 'default' }> {
    /** The in-flight batch if one exists, else up to `batchSize` events from the buffer. */
    telemetryClaimBatch(
      bufferKey: string,
      inflightKey: string,
      batchSize: number,
    ): Result<string[], Context>;
  }
}
