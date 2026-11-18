import type { AnalyticsEventDal } from '../dal/analytics-event.dal.js';
import type { EventBufferDal } from '../dal/event-buffer.dal.js';
import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';
import {
  bufferedEventSchema,
  type BufferedEvent,
  type DeadLetteredEvent,
  type DeadLetterReason,
} from '../schema/analytics-event.schema.js';

/** What one flush did. `claimed === 0` means the buffer was empty. */
export interface FlushOutcome {
  claimed: number;
  /** New rows in Postgres. Events already there (re-claimed after a crash) are not counted. */
  inserted: number;
  deadLettered: number;
}

/**
 * Moves telemetry from the Redis buffer into Postgres, one batch at a time (DESIGN.md §8.2).
 * The loop that decides *when* to flush lives in workers/telemetry-flusher.worker.ts.
 */
export interface TelemetryFlushManager {
  /**
   * claim a batch → validate each event → insert them all at once → acknowledge.
   *
   * An outage (Postgres or Redis down) throws, and the batch stays in flight: the next call
   * retries exactly the same events. Bad data never throws: those events go to the DLQ and
   * the rest of the batch is still inserted.
   */
  flushOnce: (log: Logger) => Promise<FlushOutcome>;
}

export interface TelemetryFlushManagerDependencies {
  bufferDal: Pick<EventBufferDal, 'claimBatch' | 'acknowledge'>;
  analyticsEventDal: AnalyticsEventDal;
  metrics: Metrics;
  batchSize: number;
  /** Injectable for tests. */
  now?: () => Date;
}

/** A buffer entry that passed validation, kept with its original text for the DLQ. */
interface ValidEntry {
  entry: string;
  event: BufferedEvent;
}

/** A buffer entry the flusher gives up on, on its way to the DLQ. */
interface Rejection {
  entry: string;
  reason: DeadLetterReason;
  errorCode: string | null;
  errorMessage: string;
}

export function createTelemetryFlushManager(
  deps: TelemetryFlushManagerDependencies,
): TelemetryFlushManager {
  const { bufferDal, analyticsEventDal, metrics, batchSize, now = () => new Date() } = deps;

  /**
   * Inserts every valid event. If Postgres rejects the batch for its data, one bad row has
   * failed the whole statement, so the rows are retried one at a time to find it: good rows
   * are inserted, bad ones rejected. An outage at any point throws (retry later).
   */
  async function insertAll(
    valid: readonly ValidEntry[],
    rejections: Rejection[],
    log: Logger,
  ): Promise<number> {
    if (valid.length === 0) {
      return 0;
    }
    try {
      return await analyticsEventDal.insertBatch(valid.map(({ event }) => event));
    } catch (error) {
      if (isTransientDatastoreError(error)) {
        throw error;
      }
      metrics.telemetryFlushFailures.inc({ kind: 'permanent' });
      log.error(
        { err: error, events: valid.length },
        'telemetry batch rejected, retrying row by row',
      );
    }

    let inserted = 0;
    for (const { entry, event } of valid) {
      try {
        inserted += await analyticsEventDal.insertBatch([event]);
      } catch (error) {
        if (isTransientDatastoreError(error)) {
          throw error;
        }
        rejections.push({ entry, reason: 'insert_failed', ...describeError(error) });
      }
    }
    return inserted;
  }

  function toDeadLetter(rejection: Rejection): string {
    const deadLettered: DeadLetteredEvent = {
      payload: rejection.entry,
      reason: rejection.reason,
      errorCode: rejection.errorCode,
      errorMessage: rejection.errorMessage,
      failedAt: now().toISOString(),
    };
    return JSON.stringify(deadLettered);
  }

  return {
    async flushOnce(log) {
      const entries = await bufferDal.claimBatch(batchSize);
      if (entries.length === 0) {
        return { claimed: 0, inserted: 0, deadLettered: 0 };
      }

      const valid: ValidEntry[] = [];
      const rejections: Rejection[] = [];
      for (const entry of entries) {
        const parsed = parseEntry(entry);
        if ('event' in parsed) {
          valid.push({ entry, event: parsed.event });
        } else {
          rejections.push({
            entry,
            reason: 'invalid_payload',
            errorCode: null,
            errorMessage: parsed.problem,
          });
        }
      }

      const inserted = await insertAll(valid, rejections, log);
      await bufferDal.acknowledge(rejections.map(toDeadLetter));

      // Logged and counted only now that the DLQ holds them: if this flush had thrown, the
      // batch would be retried and the same events would be rejected (and counted) again.
      for (const { reason, errorCode, errorMessage } of rejections) {
        metrics.telemetryEventsDeadLettered.inc({ reason });
        log.warn({ reason, errorCode, error: errorMessage }, 'telemetry event dead-lettered');
      }
      metrics.telemetryEventsFlushed.inc(inserted);

      const outcome = { claimed: entries.length, inserted, deadLettered: rejections.length };
      // Valid events that were neither inserted nor rejected were already in Postgres.
      const alreadyStored = entries.length - inserted - rejections.length;
      log.info({ ...outcome, alreadyStored }, 'telemetry batch flushed');
      return outcome;
    },
  };
}

/** One buffer entry → a valid event, or the reason it is not one. */
function parseEntry(entry: string): { event: BufferedEvent } | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(entry);
  } catch {
    return { problem: 'not valid JSON' };
  }

  const result = bufferedEventSchema.safeParse(json);
  if (result.success) {
    return { event: result.data };
  }
  const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  return { problem: problems.join('; ') };
}

/** The Postgres SQLSTATE (e.g. "23514" check violation) and message of a failed insert. */
function describeError(error: unknown): { errorCode: string | null; errorMessage: string } {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  return { errorCode: code, errorMessage: error instanceof Error ? error.message : String(error) };
}
