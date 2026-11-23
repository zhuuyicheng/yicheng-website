import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import { sleep as realSleep } from '../infra/sleep.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';
import type { FlushOutcome, TelemetryFlushManager } from '../services/telemetry-flush.manager.js';
import { backoffMs } from './backoff.js';

/** The flush loop: decides when to flush (DESIGN.md §8.2, §10). */
export interface TelemetryFlusher {
  /** Starts the loop in the background. */
  start: () => void;
  /**
   * Graceful stop: flushes back to back until the buffer is empty, a flush fails or `drainForMs`
   * is up. Whatever is left stays in Redis for the next start.
   */
  stop: (drainForMs: number) => Promise<void>;
}

export interface TelemetryFlusherDependencies {
  flushManager: TelemetryFlushManager;
  metrics: Metrics;
  logger: Logger;
  batchSize: number;
  flushIntervalMs: number;
  /** For tests, so they don't really wait. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

export function createTelemetryFlusher(deps: TelemetryFlusherDependencies): TelemetryFlusher {
  const { flushManager, metrics, batchSize, flushIntervalMs } = deps;
  const { sleep = realSleep, now = Date.now } = deps;
  const log = deps.logger.child({ worker: 'telemetry-flusher' });

  const wakeUp = new AbortController(); // aborting it cuts every sleep short
  let drainDeadline: number | null = null; // set by stop(): drain instead of sleeping
  let loop: Promise<void> | null = null;

  async function run(): Promise<void> {
    let consecutiveFailures = 0;

    for (;;) {
      const draining = drainDeadline !== null;
      if (drainDeadline !== null && now() >= drainDeadline) {
        log.warn('drain time is up; the remaining events stay in Redis for the next start');
        return;
      }

      let outcome: FlushOutcome;
      try {
        outcome = await flushManager.flushOnce(log);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        const transient = isTransientDatastoreError(error);
        metrics.telemetryFlushFailures.inc({ kind: transient ? 'transient' : 'unexpected' });
        if (draining) {
          log.warn({ err: error }, 'flush failed while draining; the rest stays in Redis');
          return;
        }
        const retryInMs = backoffMs(consecutiveFailures);
        const context = { err: error, consecutiveFailures, retryInMs };
        if (transient) {
          // An outage: the batch waits in flight and is retried, never dropped.
          log.warn(context, 'telemetry flush failed: datastore unavailable, will retry');
        } else {
          log.error(context, 'telemetry flush failed unexpectedly, will retry');
        }
        await sleep(retryInMs, wakeUp.signal);
        continue;
      }

      if (outcome.claimed === 0) {
        if (draining) {
          log.info('telemetry buffer drained');
          return;
        }
        log.debug('telemetry buffer empty');
        await sleep(flushIntervalMs, wakeUp.signal);
      } else if (outcome.claimed < batchSize && !draining) {
        await sleep(flushIntervalMs, wakeUp.signal); // caught up: let more events arrive
      }
      // A full batch: more may be waiting (or we're draining), so flush again now.
    }
  }

  return {
    start() {
      loop = run();
    },

    async stop(drainForMs) {
      if (loop === null) {
        return; // never started (startup failed first)
      }
      drainDeadline = now() + drainForMs;
      wakeUp.abort();
      await loop;
    },
  };
}
