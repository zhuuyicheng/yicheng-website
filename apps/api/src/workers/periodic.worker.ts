import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import { sleep as realSleep } from '../infra/sleep.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';
import { backoffMs } from './backoff.js';

/**
 * "Run this every N ms" for small housekeeping tasks. worker.ts starts two:
 *   - `notification-promoter` (every 1 s): delayed retries whose wait is over → ready;
 *   - `notification-reconciler` (every 60 s): PENDING messages with a lost job → re-queued.
 * The task itself is a manager method; this loop only decides when to run it.
 */
export interface PeriodicWorker {
  start: () => void;
  /** Lets a running task finish, then stops. Resolves once the loop has exited. */
  stop: () => Promise<void>;
}

export interface PeriodicWorkerDependencies {
  /** The loop's name in logs and in `worker_loop_failures_total{loop}`. */
  name: string;
  intervalMs: number;
  /** `true`: first run right at start. `false`: first run after one interval. */
  runImmediately: boolean;
  task: (log: Logger) => Promise<unknown>;
  metrics: Metrics;
  logger: Logger;
  /** Injectable for tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function createPeriodicWorker(deps: PeriodicWorkerDependencies): PeriodicWorker {
  const { name, intervalMs, runImmediately, task, metrics, sleep = realSleep } = deps;
  const log = deps.logger.child({ worker: name });

  const wakeUp = new AbortController(); // aborting it cuts the current (and any later) sleep short
  let stopping = false;
  // Read through a function inside the loop: TypeScript would otherwise assume `stopping`
  // cannot change there, but stop() sets it while the task is running.
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
      // After failures, wait at least the backoff: no point retrying a down datastore every second.
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
