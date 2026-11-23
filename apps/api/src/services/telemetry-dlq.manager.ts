import type { EventBufferDal } from '../dal/event-buffer.dal.js';
import type { Logger } from '../infra/logger.js';
import { deadLetteredEventSchema } from '../schema/analytics-event.schema.js';

export interface ReplayOutcome {
  /** Back in the buffer for the next flush. */
  replayed: number;
  /** Entries that aren't readable dead letters; left in place to inspect. */
  unreadable: number;
}

/**
 * Replays telemetry dead letters (DESIGN.md §8.2) once the cause is fixed: back into the
 * buffer. One that still fails returns to the DLQ.
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
          // It holds visitor data: log where, not what.
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
    return undefined; // the schema check then reports it unreadable
  }
}
