import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import { sleep as realSleep } from '../infra/sleep.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';
import type { NotificationManager } from '../services/notification.manager.js';
import { backoffMs } from './backoff.js';

const LOOP = 'notification-consumer';

/**
 * The notification consumer: runs jobs one after another, for as long as the worker runs.
 * What one job does is the manager's job (services/notification.manager.ts). DESIGN.md §8.3.
 *
 * It never sleeps between jobs: `processNext` itself waits (up to 5 s) for the next job, so a
 * new contact message is picked up the moment it is queued.
 */
export interface NotificationConsumer {
  start: () => void;
  /** Lets the current job finish, then stops. Resolves once the loop has exited. */
  stop: () => Promise<void>;
}

export interface NotificationConsumerDependencies {
  notificationManager: Pick<NotificationManager, 'processNext'>;
  metrics: Metrics;
  logger: Logger;
  /**
   * Cuts short a wait for the next job, so stop() does not have to wait up to 5 s for it to
   * time out. worker.ts closes the dedicated blocking Redis connection, which makes the
   * pending BLMOVE fail at once. Nothing is lost: if Redis had already moved a job into
   * `processing`, the next start puts it back.
   */
  interruptWait: () => void;
  /** Injectable for tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function createNotificationConsumer(
  deps: NotificationConsumerDependencies,
): NotificationConsumer {
  const { notificationManager, metrics, interruptWait, sleep = realSleep } = deps;
  const log = deps.logger.child({ worker: LOOP });

  const wakeUp = new AbortController(); // cuts a backoff sleep short on stop
  let stopping = false;
  // Read through a function inside the loop: TypeScript would otherwise assume `stopping`
  // cannot change there, but stop() sets it while the loop is waiting on an `await`.
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
          break; // the wait was interrupted on purpose by stop()
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
          // The job (if any) waits in `processing`; the next processNext puts it back.
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
