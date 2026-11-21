import type { Redis } from '../infra/redis.js';
import { BOUNDED_ENQUEUE_SCRIPT } from './lua/bounded-enqueue.lua.js';
import { CLAIM_BATCH_SCRIPT } from './lua/claim-batch.lua.js';

/** Redis keys of the telemetry pipeline (DESIGN.md §6.2). Data, not cache: none has a TTL. */
export const TELEMETRY_BUFFER_KEYS = {
  /** LIST of event JSON: the API appends on the right, the flusher claims from the left. */
  buffer: 'telemetry:events:buffer',
  /** LIST: the batch the flusher is working on, until Postgres has it. */
  inflight: 'telemetry:events:inflight',
  /** LIST of dead-letter JSON: events that can never be inserted as they are. */
  deadLetter: 'telemetry:events:dlq',
} as const;

/**
 * Redis DAL for the telemetry buffer: the lists between the API (producer) and the worker's
 * flusher (consumer). Every event id is unique and Postgres skips ids it already has, so the
 * consumer side may safely process an event twice ("at least once"), never zero times.
 */
export interface EventBufferDal {
  /** API: appends one event unless the buffer already holds `maxLength`. `false` = full. */
  enqueue: (eventJson: string, maxLength: number) => Promise<boolean>;
  /** Flusher: the unacknowledged in-flight batch if any, else up to `batchSize` new events. */
  claimBatch: (batchSize: number) => Promise<string[]>;
  /** Flusher: the batch is in Postgres; store its dead letters and release it. */
  acknowledge: (deadLetters: readonly string[]) => Promise<void>;
  /** `npm run dlq:replay`: every dead-letter entry, oldest first. */
  listDeadLetters: () => Promise<string[]>;
  /** `npm run dlq:replay`: puts `payload` back in the buffer and removes its DLQ `entry`. */
  replayDeadLetter: (entry: string, payload: string) => Promise<void>;
}

export function createEventBufferDal(redis: Redis): EventBufferDal {
  for (const script of [BOUNDED_ENQUEUE_SCRIPT, CLAIM_BATCH_SCRIPT]) {
    redis.defineCommand(script.name, { numberOfKeys: script.numberOfKeys, lua: script.lua });
  }

  return {
    async enqueue(eventJson, maxLength) {
      const appended = await redis.telemetryBoundedEnqueue(
        TELEMETRY_BUFFER_KEYS.buffer,
        maxLength,
        eventJson,
      );
      return appended === 1;
    },

    claimBatch(batchSize) {
      return redis.telemetryClaimBatch(
        TELEMETRY_BUFFER_KEYS.buffer,
        TELEMETRY_BUFFER_KEYS.inflight,
        batchSize,
      );
    },

    async acknowledge(deadLetters) {
      // Order matters: dead letters are saved before the batch is released. If the worker
      // crashes in between, the batch is claimed again: its good events are re-inserted as
      // no-ops, and its bad ones are dead-lettered a second time. A duplicate, never a loss.
      if (deadLetters.length > 0) {
        await redis.rpush(TELEMETRY_BUFFER_KEYS.deadLetter, ...deadLetters);
      }
      await redis.del(TELEMETRY_BUFFER_KEYS.inflight);
    },

    listDeadLetters() {
      return redis.lrange(TELEMETRY_BUFFER_KEYS.deadLetter, 0, -1);
    },

    async replayDeadLetter(entry, payload) {
      // Push first, then remove: a crash in between leaves a duplicate, which is harmless
      // because the insert skips ids it already has.
      await redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, payload);
      await redis.lrem(TELEMETRY_BUFFER_KEYS.deadLetter, 1, entry);
    },
  };
}
