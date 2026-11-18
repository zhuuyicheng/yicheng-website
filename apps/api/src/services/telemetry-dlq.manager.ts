import type { EventBufferDal } from '../dal/event-buffer.dal.js';
import type { Logger } from '../infra/logger.js';
import { deadLetteredEventSchema } from '../schema/analytics-event.schema.js';

export interface ReplayOutcome {
  /** Moved back into the buffer; the worker retries them on its next flush. */
  replayed: number;
  /** DLQ entries that are not readable dead letters; left in place for you to inspect. */
  unreadable: number;
}

/**
 * The telemetry dead-letter queue (DESIGN.md §8.2). Events land there when the flusher can
 * never insert them as they are. After fixing the cause (a migration, a code fix), replaying
 * puts them back in the buffer. One that still fails simply returns to the DLQ.
 */
export interface TelemetryDlqManager {
  replay: (log: Logger) => Promise<ReplayOutcome>;
}

export function createTelemetryDlqManager(deps: {
  bufferDal: Pick<EventBufferDal, 'listDeadLetters' | 'replayDeadLetter'>;
}): TelemetryDlqManager {
  const { bufferDal } = deps;

  return {
    async replay(log) {
      const entries = await bufferDal.listDeadLetters();
      let replayed = 0;
      let unreadable = 0;

      for (const [index, entry] of entries.entries()) {
        const deadLettered = deadLetteredEventSchema.safeParse(parseJson(entry));
        if (!deadLettered.success) {
          unreadable += 1;
          // The entry holds visitor data, so log where it is, not what it says.
          log.warn({ index }, 'unreadable DLQ entry left in place');
          continue;
        }
        await bufferDal.replayDeadLetter(entry, deadLettered.data.payload);
        replayed += 1;
      }

      return { replayed, unreadable };
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // fails the schema check, which reports it as unreadable
  }
}
