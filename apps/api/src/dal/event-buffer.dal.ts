import type { Redis } from '../infra/redis.js';
import { BOUNDED_ENQUEUE_SCRIPT } from './lua/bounded-enqueue.lua.js';

/** Redis keys of the telemetry pipeline. See DESIGN.md §6.2. */
export const TELEMETRY_BUFFER_KEYS = {
  /** LIST of event JSON: the API appends on the right, the flusher takes from the left. */
  buffer: 'telemetry:events:buffer',
} as const;

/**
 * Redis DAL for the telemetry buffer: the list between the API (producer) and the worker's
 * flusher (consumer, Phase 3 step 4). The buffer is data, not cache, so it has no TTL.
 */
export interface EventBufferDal {
  /** Appends one event unless the buffer already holds `maxLength`. `false` = full. */
  enqueue: (eventJson: string, maxLength: number) => Promise<boolean>;
}

export function createEventBufferDal(redis: Redis): EventBufferDal {
  redis.defineCommand(BOUNDED_ENQUEUE_SCRIPT.name, {
    numberOfKeys: BOUNDED_ENQUEUE_SCRIPT.numberOfKeys,
    lua: BOUNDED_ENQUEUE_SCRIPT.lua,
  });

  return {
    async enqueue(eventJson, maxLength) {
      const appended = await redis.telemetryBoundedEnqueue(
        TELEMETRY_BUFFER_KEYS.buffer,
        maxLength,
        eventJson,
      );
      return appended === 1;
    },
  };
}
