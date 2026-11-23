import type { Redis } from '../infra/redis.js';
import type { DelayedEntry, QueuePeek } from '../schema/queue-items.schema.js';
import { PROMOTE_DUE_JOBS_SCRIPT } from './lua/promote-due-jobs.lua.js';
import { execOrThrow, stringList } from './redis-exec.js';

/** Redis keys of the notification job queue (DESIGN.md §6.2). Data, not cache: none has a TTL. */
export const NOTIFICATION_QUEUE_KEYS = {
  /** LIST of job JSON, ready to run: `LPUSH` in, taken from the right (oldest first). */
  ready: 'jobs:notifications:ready',
  /** LIST: the job the worker is running right now. */
  processing: 'jobs:notifications:processing',
  /** ZSET of job JSON scored by the time (ms) it may run: retries waiting out their backoff. */
  delayed: 'jobs:notifications:delayed',
  /** LIST of dead-letter JSON, oldest first: jobs that failed for good. */
  deadLetter: 'jobs:notifications:dlq',
} as const;

/**
 * Redis DAL for the notification job queue between the API (producer) and the worker's
 * notification consumer. See DESIGN.md §6.6 and §8.3.
 *
 * A job is always in exactly one place: ready → processing → (gone | delayed | dlq). Every
 * move is atomic (one command, a MULTI transaction, or a Lua script), so a crash can never
 * lose a job, only leave it in `processing`, from where `requeueStranded` brings it back.
 */
export interface NotificationQueueDal {
  /** API and reconciler: adds a job to the ready list. */
  enqueue: (jobJson: string) => Promise<void>;
  /**
   * Worker: moves the oldest ready job to `processing` and returns it, waiting up to
   * `timeoutSeconds` for one to arrive. `null` = none arrived. Needs the blocking connection.
   */
  take: (timeoutSeconds: number) => Promise<string | null>;
  /** Worker: the job is done (sent, or skipped); remove it from `processing`. */
  complete: (jobJson: string) => Promise<void>;
  /** Worker: replace the job in `processing` with `nextJobJson`, due at `runAtMs`. */
  retryLater: (jobJson: string, nextJobJson: string, runAtMs: number) => Promise<void>;
  /** Worker: move the job from `processing` to the DLQ, stored as `deadLetterJson`. */
  deadLetter: (jobJson: string, deadLetterJson: string) => Promise<void>;
  /** Worker: anything left in `processing` (by a crash) goes back to be taken next. */
  requeueStranded: () => Promise<number>;
  /** Worker's promoter: delayed jobs due by `nowMs` → `ready`. Returns how many moved. */
  promoteDue: (nowMs: number, maxJobs: number) => Promise<number>;
  /** `npm run dlq:replay -- notifications`: every dead-letter entry, oldest first. */
  listDeadLetters: () => Promise<string[]>;
  /** `npm run dlq:replay`: queues `jobJson` and removes its DLQ `entry`. */
  replayDeadLetter: (entry: string, jobJson: string) => Promise<void>;
  // The owner's queue card reads these without taking anything out (DESIGN.md §7.8).
  /** How many jobs are ready, and the newest `limit`, newest first. */
  peekReady: (limit: number) => Promise<QueuePeek>;
  /** How many retries wait out their delay, and the `limit` due soonest, soonest first. */
  peekDelayed: (limit: number) => Promise<QueuePeek<DelayedEntry>>;
  /** How many dead letters there are, and the newest `limit`, newest first. */
  peekDeadLetters: (limit: number) => Promise<QueuePeek>;
}

/**
 * @param redis the shared connection, for every short command.
 * @param blockingRedis a connection of its own for `take`, or `null` where nothing takes jobs
 *   (the API). BLMOVE can wait 5 s for a job, and a waiting connection cannot run any other
 *   command, so sharing it would freeze everything else using that connection.
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
      // One atomic step: the job is never "in neither list", even if the worker dies here.
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
      // ioredis types LMOVE's reply as `string`, but Redis answers nil once the list is empty.
      const moveOne = (): Promise<string | null> =>
        // The right end of `ready` is taken next. LEFT→RIGHT moves keep the original order.
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
      // Queue first, then remove: a crash in between leaves a duplicate job, which the worker
      // skips once the message is SENT. Never a lost one.
      await redis.lpush(keys.ready, jobJson);
      await redis.lrem(keys.deadLetter, 1, entry);
    },

    // Each peek is one MULTI, so the count and the entries describe the same moment.

    async peekReady(limit) {
      // LPUSH adds on the left: the newest are first already.
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
        // ioredis types ZRANGE's `stop` as a string only.
        redis
          .multi()
          .zcard(keys.delayed)
          .zrange(keys.delayed, 0, String(limit - 1), 'WITHSCORES'),
      );
      // WITHSCORES answers [job, score, job, score, …], lowest score (due soonest) first.
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
      // RPUSH adds on the right: the newest are last.
      const [total, newestLast] = await execOrThrow(
        redis.multi().llen(keys.deadLetter).lrange(keys.deadLetter, -limit, -1),
      );
      return { total: Number(total), entries: stringList(newestLast).reverse() };
    },
  };
}
