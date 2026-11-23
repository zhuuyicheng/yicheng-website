import type { Redis } from '../infra/redis.js';
import type { QueuePeek } from '../schema/queue-items.schema.js';
import { BOUNDED_ENQUEUE_SCRIPT } from './lua/bounded-enqueue.lua.js';
import { CLAIM_BATCH_SCRIPT } from './lua/claim-batch.lua.js';
import { execOrThrow, stringList } from './redis-exec.js';

/** Telemetry keys (DESIGN.md §6.2). Data, not cache: no TTLs. */
export const TELEMETRY_BUFFER_KEYS = {
  /** LIST of event JSON: the API appends right, the flusher takes left. */
  buffer: 'telemetry:events:buffer',
  /** LIST: the flusher's batch, until Postgres has it. */
  inflight: 'telemetry:events:inflight',
  /** LIST of dead-letter JSON: events that can never be inserted as they are. */
  deadLetter: 'telemetry:events:dlq',
} as const;

/**
 * Redis DAL for the telemetry buffer between the API and the flusher. Event ids are unique and
 * Postgres skips known ones, so an event may be processed twice, never zero times.
 */
export interface EventBufferDal {
  /** API: appends unless the buffer holds `maxLength`; `false` = full. */
  enqueue: (eventJson: string, maxLength: number) => Promise<boolean>;
  /** Flusher: the unacknowledged batch if any, else up to `batchSize` new events. */
  claimBatch: (batchSize: number) => Promise<string[]>;
  /** Flusher: the batch is in Postgres; store its dead letters and release it. */
  acknowledge: (deadLetters: readonly string[]) => Promise<void>;
  /** `dlq:replay`: every dead letter, oldest first. */
  listDeadLetters: () => Promise<string[]>;
  /** `dlq:replay`: puts `payload` back in the buffer and removes its DLQ `entry`. */
  replayDeadLetter: (entry: string, payload: string) => Promise<void>;
  /** Queue card: the count, and the newest `limit` first. */
  peekBuffer: (limit: number) => Promise<QueuePeek>;
  /** Queue card: the count, and the newest `limit` first. */
  peekDeadLetters: (limit: number) => Promise<QueuePeek>;
}

export function createEventBufferDal(redis: Redis): EventBufferDal {
  for (const script of [BOUNDED_ENQUEUE_SCRIPT, CLAIM_BATCH_SCRIPT]) {
    redis.defineCommand(script.name, { numberOfKeys: script.numberOfKeys, lua: script.lua });
  }

  /** Removes nothing. Both lists grow on the right, so the newest are last. */
  async function peekNewest(key: string, limit: number): Promise<QueuePeek> {
    // MULTI, so the count and the entries are from the same moment.
    const [total, newestLast] = await execOrThrow(redis.multi().llen(key).lrange(key, -limit, -1));
    return { total: Number(total), entries: stringList(newestLast).reverse() };
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
      // Dead letters are saved before the batch is released: a crash in between means the batch is
      // claimed again and processed twice. A duplicate, never a loss.
      if (deadLetters.length > 0) {
        await redis.rpush(TELEMETRY_BUFFER_KEYS.deadLetter, ...deadLetters);
      }
      await redis.del(TELEMETRY_BUFFER_KEYS.inflight);
    },

    listDeadLetters() {
      return redis.lrange(TELEMETRY_BUFFER_KEYS.deadLetter, 0, -1);
    },

    async replayDeadLetter(entry, payload) {
      // Push, then remove: a crash in between leaves a harmless duplicate (known ids are skipped).
      await redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, payload);
      await redis.lrem(TELEMETRY_BUFFER_KEYS.deadLetter, 1, entry);
    },

    peekBuffer(limit) {
      return peekNewest(TELEMETRY_BUFFER_KEYS.buffer, limit);
    },

    peekDeadLetters(limit) {
      return peekNewest(TELEMETRY_BUFFER_KEYS.deadLetter, limit);
    },
  };
}
