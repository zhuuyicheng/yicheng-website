import type { Redis } from '../infra/redis.js';

/** Redis keys of the notification job queue. All are data, not cache: none has a TTL. DESIGN.md §6.2. */
export const NOTIFICATION_QUEUE_KEYS = {
  /** LIST of job JSON, ready to run: `LPUSH` in, taken from the right (oldest first). */
  ready: 'jobs:notifications:ready',
  /** LIST: the job the worker is running right now. */
  processing: 'jobs:notifications:processing',
  /** ZSET of job JSON scored by the time (ms) it may run: retries waiting out their backoff. */
  delayed: 'jobs:notifications:delayed',
  /** LIST of dead-letter JSON: jobs that failed for good. */
  deadLetter: 'jobs:notifications:dlq',
} as const;

/**
 * Redis DAL for the notification job queue between the API (producer) and the worker's
 * notification consumer. See DESIGN.md §6.6 and §8.3.
 */
export interface NotificationQueueDal {
  /** API (and the reconciler): adds a job to the ready list. */
  enqueue: (jobJson: string) => Promise<void>;
}

export function createNotificationQueueDal(redis: Redis): NotificationQueueDal {
  return {
    async enqueue(jobJson) {
      await redis.lpush(NOTIFICATION_QUEUE_KEYS.ready, jobJson);
    },
  };
}
