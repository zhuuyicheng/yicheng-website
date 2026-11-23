import type { ClientContext, Result } from 'ioredis';

/**
 * Moves the next batch from the buffer to the in-flight list in one atomic step (DESIGN.md
 * §6.5). The flusher deletes it only once Postgres has it; until then each claim returns the
 * same batch, so a crash loses nothing.
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

// Declares the command `defineCommand` adds at runtime.
declare module 'ioredis' {
  interface RedisCommander<Context extends ClientContext = { type: 'default' }> {
    /** The in-flight batch if any, else up to `batchSize` events from the buffer. */
    telemetryClaimBatch(
      bufferKey: string,
      inflightKey: string,
      batchSize: number,
    ): Result<string[], Context>;
  }
}
