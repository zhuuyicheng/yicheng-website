import type { Redis } from '../infra/redis.js';
import type { DelayedEntry, QueuePeek } from '../schema/queue-items.schema.js';
import { PROMOTE_DUE_JOBS_SCRIPT } from './lua/promote-due-jobs.lua.js';
import { execOrThrow, stringList } from './redis-exec.js';

/** Notification queue keys (DESIGN.md §6.2). Data, not cache: no TTLs. */
export const NOTIFICATION_QUEUE_KEYS = {
  /** LIST of job JSON: LPUSH in, taken from the right (oldest first). */
  ready: 'jobs:notifications:ready',
  /** LIST: the job being run. */
  processing: 'jobs:notifications:processing',
  /** ZSET of job JSON scored by when it may run: retries waiting out their backoff. */
  delayed: 'jobs:notifications:delayed',
  /** LIST of dead-letter JSON, oldest first. */
  deadLetter: 'jobs:notifications:dlq',
} as const;

/**
 * Redis DAL for notification jobs (DESIGN.md §6.6, §8.3). A job is in exactly one place
 * (ready → processing → gone, delayed or dlq), moved atomically, so a crash can only leave it
 * in `processing`, where `requeueStranded` finds it.
 */
export interface NotificationQueueDal {
  /** API and reconciler: adds a ready job. */
  enqueue: (jobJson: string) => Promise<void>;
  /**
   * Worker: moves the oldest ready job to `processing`, waiting up to `timeoutSeconds`.
   * `null` = none came. Needs the blocking connection.
   */
  take: (timeoutSeconds: number) => Promise<string | null>;
  /** Worker: done (sent or skipped); remove it from `processing`. */
  complete: (jobJson: string) => Promise<void>;
  /** Worker: replace the job in `processing` with `nextJobJson`, due at `runAtMs`. */
  retryLater: (jobJson: string, nextJobJson: string, runAtMs: number) => Promise<void>;
  /** Worker: `processing` → DLQ, stored as `deadLetterJson`. */
  deadLetter: (jobJson: string, deadLetterJson: string) => Promise<void>;
  /** Worker: whatever a crash left in `processing` goes back to be taken next. */
  requeueStranded: () => Promise<number>;
  /** Promoter: delayed jobs due by `nowMs` → `ready`; returns how many moved. */
  promoteDue: (nowMs: number, maxJobs: number) => Promise<number>;
  /** `dlq:replay`: every dead letter, oldest first. */
  listDeadLetters: () => Promise<string[]>;
  /** `npm run dlq:replay`: queues `jobJson` and removes its DLQ `entry`. */
  replayDeadLetter: (entry: string, jobJson: string) => Promise<void>;
  // Queue card reads; nothing is taken out (DESIGN.md §7.8).
  /** The count, and the newest `limit` first. */
  peekReady: (limit: number) => Promise<QueuePeek>;
  /** The count, and the `limit` due soonest first. */
  peekDelayed: (limit: number) => Promise<QueuePeek<DelayedEntry>>;
  /** The count, and the newest `limit` first. */
  peekDeadLetters: (limit: number) => Promise<QueuePeek>;
}

/**
 * @param blockingRedis a connection of its own for `take`, or `null` where nothing takes jobs
 *   (the API). BLMOVE waits for a job, and a waiting connection can't run anything else.
 */
export function createNotificationQueueDal(
  redis: Redis,
  blockingRedis: Redis | null = null,
): NotificationQueueDal {
  redis.defineCommand(PROMOTE_DUE_JOBS_SCRIPT.name, {
    numberOfKeys: PROMOTE_DUE_JOBS_SCRIPT.numberOfKeys,
    lua: PROMOTE_DUE_JOBS_SCRIPT.lua,
  });
  const keys = NOTIFICATION_QUEUE_KEYS;

  return {
    async enqueue(jobJson) {
      await redis.lpush(keys.ready, jobJson);
    },

    take(timeoutSeconds) {
      if (blockingRedis === null) {
        throw new Error('take() needs the dedicated blocking Redis connection');
      }
      // One atomic step: the job is never in neither list.
      return blockingRedis.blmove(keys.ready, keys.processing, 'RIGHT', 'LEFT', timeoutSeconds);
    },

    async complete(jobJson) {
      await redis.lrem(keys.processing, 1, jobJson);
    },

    async retryLater(jobJson, nextJobJson, runAtMs) {
      await execOrThrow(
        redis.multi().lrem(keys.processing, 1, jobJson).zadd(keys.delayed, runAtMs, nextJobJson),
      );
    },

    async deadLetter(jobJson, deadLetterJson) {
      await execOrThrow(
        redis.multi().lrem(keys.processing, 1, jobJson).rpush(keys.deadLetter, deadLetterJson),
      );
    },

    async requeueStranded() {
      // ioredis types the reply as `string`, but an empty list answers nil.
      const moveOne = (): Promise<string | null> =>
        // The right end of `ready` goes next; LEFT→RIGHT keeps the order.
        redis.lmove(keys.processing, keys.ready, 'LEFT', 'RIGHT');
      let moved = 0;
      while ((await moveOne()) !== null) {
        moved += 1;
      }
      return moved;
    },

    promoteDue(nowMs, maxJobs) {
      return redis.notificationsPromoteDue(keys.delayed, keys.ready, nowMs, maxJobs);
    },

    listDeadLetters() {
      return redis.lrange(keys.deadLetter, 0, -1);
    },

    async replayDeadLetter(entry, jobJson) {
      // Queue, then remove: a crash leaves a duplicate (skipped once SENT), never a loss.
      await redis.lpush(keys.ready, jobJson);
      await redis.lrem(keys.deadLetter, 1, entry);
    },

    // Each peek is one MULTI: count and entries from the same moment.

    async peekReady(limit) {
      // LPUSH adds on the left, so the newest are first.
      const [total, entries] = await execOrThrow(
        redis
          .multi()
          .llen(keys.ready)
          .lrange(keys.ready, 0, limit - 1),
      );
      return { total: Number(total), entries: stringList(entries) };
    },

    async peekDelayed(limit) {
      const [total, flat] = await execOrThrow(
        // ioredis types `stop` as a string.
        redis
          .multi()
          .zcard(keys.delayed)
          .zrange(keys.delayed, 0, String(limit - 1), 'WITHSCORES'),
      );
      // [job, score, job, score, …], due soonest first.
      const memberThenScore = stringList(flat);
      const entries: DelayedEntry[] = [];
      for (let i = 0; i < memberThenScore.length; i += 2) {
        const entry = memberThenScore[i];
        const score = memberThenScore[i + 1];
        if (entry === undefined || score === undefined) break;
        entries.push({ entry, dueAtMs: Number(score) });
      }
      return { total: Number(total), entries };
    },

    async peekDeadLetters(limit) {
      // RPUSH adds on the right, so the newest are last.
      const [total, newestLast] = await execOrThrow(
        redis.multi().llen(keys.deadLetter).lrange(keys.deadLetter, -limit, -1),
      );
      return { total: Number(total), entries: stringList(newestLast).reverse() };
    },
  };
}
