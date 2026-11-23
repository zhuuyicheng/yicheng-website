import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import { sleep as realSleep } from '../infra/sleep.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';
import { backoffMs } from './backoff.js';

/**
 * Runs a manager method every N ms: the promoter (1 s, due retries → ready) and the
 * reconciler (60 s, re-queues messages whose job was lost).
 */
export interface PeriodicWorker {
  start: () => void;
  /** Lets a running task finish, then stops. */
  stop: () => Promise<void>;
}

export interface PeriodicWorkerDependencies {
  /** For logs and `worker_loop_failures_total{loop}`. */
  name: string;
  intervalMs: number;
  /** `true`: first run at start; `false`: after one interval. */
  runImmediately: boolean;
  task: (log: Logger) => Promise<unknown>;
  metrics: Metrics;
  logger: Logger;
  /** For tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function createPeriodicWorker(deps: PeriodicWorkerDependencies): PeriodicWorker {
  const { name, intervalMs, runImmediately, task, metrics, sleep = realSleep } = deps;
  const log = deps.logger.child({ worker: name });

  const wakeUp = new AbortController(); // aborting it cuts every sleep short
  let stopping = false;
  // A function, or TypeScript assumes `stopping` can't change during the task.
  const isStopping = (): boolean => stopping;
  let loop: Promise<void> | null = null;

  async function run(): Promise<void> {
    let consecutiveFailures = 0;
    if (!runImmediately) {
      await sleep(intervalMs, wakeUp.signal);
    }

    while (!stopping) {
      try {
        await task(log);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        const transient = isTransientDatastoreError(error);
        metrics.workerLoopFailures.inc({
          loop: name,
          kind: transient ? 'transient' : 'unexpected',
        });
        const context = { err: error, consecutiveFailures };
        if (transient) {
          log.warn(context, `${name}: datastore unavailable, will retry`);
        } else {
          log.error(context, `${name} failed unexpectedly, will retry`);
        }
      }
      if (isStopping()) {
        break;
      }
      // After failures, wait at least the backoff.
      const waitMs =
        consecutiveFailures === 0
          ? intervalMs
          : Math.max(intervalMs, backoffMs(consecutiveFailures));
      await sleep(waitMs, wakeUp.signal);
    }
  }

  return {
    start() {
      loop = run();
    },

    async stop() {
      if (loop === null) {
        return; // never started
      }
      stopping = true;
      wakeUp.abort();
      await loop;
    },
  };
}
