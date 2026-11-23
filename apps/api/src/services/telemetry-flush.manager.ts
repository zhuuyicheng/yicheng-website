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

/** What one flush did; `claimed === 0` = the buffer was empty. */
export interface FlushOutcome {
  claimed: number;
  /** New rows only; events already stored (re-claimed after a crash) don't count. */
  inserted: number;
  deadLettered: number;
}

/** Redis buffer → Postgres, one batch at a time (DESIGN.md §8.2); workers/ decide when. */
export interface TelemetryFlushManager {
  /**
   * Claim, validate, insert, acknowledge. An outage throws and the batch stays in flight for the
   * next call. Bad data never throws: those events go to the DLQ, the rest are inserted.
   */
  flushOnce: (log: Logger) => Promise<FlushOutcome>;
}

export interface TelemetryFlushManagerDependencies {
  bufferDal: Pick<EventBufferDal, 'claimBatch' | 'acknowledge'>;
  analyticsEventDal: Pick<AnalyticsEventDal, 'insertBatch'>;
  metrics: Metrics;
  batchSize: number;
  /** For tests. */
  now?: () => Date;
}

/** A valid entry, with its original text for the DLQ. */
interface ValidEntry {
  entry: string;
  event: BufferedEvent;
}

/** An entry on its way to the DLQ. */
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
   * Inserts every valid event. If Postgres refuses the batch for its data, retries row by row to
   * find the bad ones. An outage at any point throws.
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

      // Logged and counted only once in the DLQ: had the flush thrown, they'd be counted twice.
      for (const { reason, errorCode, errorMessage } of rejections) {
        metrics.telemetryEventsDeadLettered.inc({ reason });
        log.warn({ reason, errorCode, error: errorMessage }, 'telemetry event dead-lettered');
      }
      metrics.telemetryEventsFlushed.inc(inserted);

      const outcome = { claimed: entries.length, inserted, deadLettered: rejections.length };
      // Neither inserted nor rejected: already in Postgres.
      const alreadyStored = entries.length - inserted - rejections.length;
      log.info({ ...outcome, alreadyStored }, 'telemetry batch flushed');
      return outcome;
    },
  };
}

/** Entry → a valid event, or why it isn't one. */
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

/** SQLSTATE (e.g. "23514") and message of a failed insert. */
function describeError(error: unknown): { errorCode: string | null; errorMessage: string } {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  return { errorCode: code, errorMessage: error instanceof Error ? error.message : String(error) };
}
