import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import { sleep as realSleep } from '../infra/sleep.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';
import type { NotificationManager } from '../services/notification.manager.js';
import { backoffMs } from './backoff.js';

const LOOP = 'notification-consumer';

/**
 * Runs notification jobs one after another (DESIGN.md §8.3). No sleep between jobs:
 * `processNext` waits for the next one, so a new message is picked up at once.
 */
export interface NotificationConsumer {
  start: () => void;
  /** Lets the current job finish, then stops. */
  stop: () => Promise<void>;
}

export interface NotificationConsumerDependencies {
  notificationManager: Pick<NotificationManager, 'processNext'>;
  metrics: Metrics;
  logger: Logger;
  /**
   * Ends a pending wait for a job so stop() is quick: worker.ts closes the blocking connection.
   * Nothing is lost: a job already in `processing` is put back on the next start.
   */
  interruptWait: () => void;
  /** For tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function createNotificationConsumer(
  deps: NotificationConsumerDependencies,
): NotificationConsumer {
  const { notificationManager, metrics, interruptWait, sleep = realSleep } = deps;
  const log = deps.logger.child({ worker: LOOP });

  const wakeUp = new AbortController(); // cuts a backoff sleep short on stop
  let stopping = false;
  // A function, or TypeScript assumes `stopping` can't change across the loop's awaits.
  const isStopping = (): boolean => stopping;
  let loop: Promise<void> | null = null;

  async function run(): Promise<void> {
    let consecutiveFailures = 0;

    while (!stopping) {
      try {
        await notificationManager.processNext(log);
        consecutiveFailures = 0;
      } catch (error) {
        if (isStopping()) {
          break; // interrupted on purpose by stop()
        }
        consecutiveFailures += 1;
        const transient = isTransientDatastoreError(error);
        metrics.workerLoopFailures.inc({
          loop: LOOP,
          kind: transient ? 'transient' : 'unexpected',
        });
        const retryInMs = backoffMs(consecutiveFailures);
        const context = { err: error, consecutiveFailures, retryInMs };
        if (transient) {
          // The job waits in `processing`; the next processNext puts it back.
          log.warn(context, 'notification consumer: datastore unavailable, will retry');
        } else {
          log.error(context, 'notification consumer failed unexpectedly, will retry');
        }
        await sleep(retryInMs, wakeUp.signal);
      }
    }
    log.info('notification consumer stopped');
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
      interruptWait();
      await loop;
    },
  };
}
