import { randomUUID } from 'node:crypto';
import type { ContactMessageDal } from '../dal/contact-message.dal.js';
import type { NotificationQueueDal } from '../dal/notification-queue.dal.js';
import type { Logger } from '../infra/logger.js';
import type { Metrics, NotificationJobOutcome } from '../infra/metrics.js';
import { NotificationError, type Notifier } from '../infra/notifiers/notifier.js';
import {
  notificationJobSchema,
  type DeadLetteredJob,
  type JobDeadLetterReason,
  type NotificationJob,
} from '../schema/notification-job.schema.js';

/** How long one `take` waits for a job. Short, so a stopping worker is never stuck long. */
const TAKE_TIMEOUT_SECONDS = 5;
const PROMOTE_BATCH_SIZE = 100;
/** A PENDING message untouched this long has lost its job (DESIGN.md §8.3, step 7). */
const STALE_AFTER_SECONDS = 5 * 60;
const RECONCILE_BATCH_SIZE = 100;
/**
 * Retries never wait longer than this. It stays below STALE_AFTER_SECONDS on purpose: a retry
 * waiting in `delayed` must not look like a lost message to the reconciler.
 */
export const MAX_RETRY_DELAY_MS = 4 * 60 * 1000;

/**
 * Delay before retrying after attempt `failedAttempt` failed: base × 2^(attempt − 1), ± 20 %
 * jitter, capped at MAX_RETRY_DELAY_MS. With the defaults (5 s, 3 attempts): ~5 s, then ~10 s.
 *
 * Why jitter: if many jobs failed at the same moment (the webhook was down), identical delays
 * would make them all retry at the same moment too, and possibly fail together again.
 */
export function retryDelayMs(failedAttempt: number, baseMs: number, random: () => number): number {
  const exponential = baseMs * 2 ** (failedAttempt - 1);
  const jitter = 0.8 + 0.4 * random(); // a factor between 0.8 and 1.2
  return Math.min(Math.round(exponential * jitter), MAX_RETRY_DELAY_MS);
}

/** What `processNext` did: finished one job, or found none to do within the wait. */
export type ProcessOutcome = NotificationJobOutcome | 'idle';

/**
 * Notification jobs, from the queue to the site owner's inbox (DESIGN.md §8.3). The worker
 * loops that decide *when* to call these live in workers/.
 *
 * Delivery is at least once: a crash at the wrong moment can repeat a notification, never
 * drop one. Every step that could repeat is made harmless by checking the message's status.
 */
export interface NotificationManager {
  /**
   * Takes the next job (waiting up to 5 s) and runs it: send, then sent / retry / DLQ.
   *
   * First, it puts back anything left in `processing`. There is one consumer and it runs one
   * job at a time, so between two jobs that list must be empty: whatever is there was left by
   * a crash or an outage mid-job. This one rule covers both startup and recovery.
   */
  processNext: (log: Logger) => Promise<ProcessOutcome>;
  /** Moves retries whose backoff is over from `delayed` to `ready`. */
  promoteDue: (log: Logger) => Promise<number>;
  /** Queues a new job for every message PENDING for over 5 minutes with no job in sight. */
  reconcile: (log: Logger) => Promise<number>;
}

export interface NotificationManagerDependencies {
  contactMessageDal: Pick<
    ContactMessageDal,
    'findById' | 'markSent' | 'recordFailedAttempt' | 'markFailed' | 'claimStalePending'
  >;
  queueDal: Pick<
    NotificationQueueDal,
    'take' | 'complete' | 'retryLater' | 'deadLetter' | 'requeueStranded' | 'promoteDue' | 'enqueue'
  >;
  notifier: Notifier;
  metrics: Metrics;
  /** Total attempts, including the first. */
  maxAttempts: number;
  backoffBaseMs: number;
  /** Injectable for tests. */
  now?: () => Date;
  random?: () => number;
  newJobId?: () => string;
}

export function createNotificationManager(
  deps: NotificationManagerDependencies,
): NotificationManager {
  const { contactMessageDal, queueDal, notifier, metrics, maxAttempts, backoffBaseMs } = deps;
  const { now = () => new Date(), random = Math.random, newJobId = randomUUID } = deps;

  function deadLetterEntry(entry: string, reason: JobDeadLetterReason, error: string): string {
    const deadLetter: DeadLetteredJob = {
      payload: entry,
      reason,
      error,
      failedAt: now().toISOString(),
    };
    return JSON.stringify(deadLetter);
  }

  /** Runs one job taken from the queue. `entry` is its exact text, needed to remove it. */
  async function run(entry: string, log: Logger): Promise<NotificationJobOutcome> {
    const parsed = parseJob(entry);
    if ('problem' in parsed) {
      await queueDal.deadLetter(entry, deadLetterEntry(entry, 'invalid_payload', parsed.problem));
      log.warn(
        { reason: 'invalid_payload', error: parsed.problem },
        'notification job dead-lettered',
      );
      return 'dead_lettered';
    }

    const { job } = parsed;
    const jobLog = log.child({ jobId: job.jobId, messageId: job.messageId, attempt: job.attempt });

    // Idempotency: the job may be a repeat (a crash after sending, a reconciler re-queue).
    // Only a PENDING message still needs notifying.
    const message = await contactMessageDal.findById(job.messageId);
    if (message?.status !== 'PENDING') {
      await queueDal.complete(entry);
      jobLog.info({ status: message?.status ?? 'missing' }, 'notification job skipped');
      return 'skipped';
    }

    // Only the notifier's own failure is caught here. If Postgres or Redis fails in the steps
    // below, the error escapes on purpose: the job stays in `processing`, and the consumer
    // loop requeues it once the outage is over. An outage must not use up the attempts.
    let failure: NotificationError | null = null;
    try {
      await notifier.send(message);
    } catch (error) {
      failure = asNotificationError(error);
    }

    if (failure === null) {
      await contactMessageDal.markSent(message.id, job.attempt);
      await queueDal.complete(entry);
      jobLog.info({ driver: notifier.driver }, 'notification sent');
      return 'sent';
    }

    if (failure.retryable && job.attempt < maxAttempts) {
      const delayMs = retryDelayMs(job.attempt, backoffBaseMs, random);
      const retryAt = now();
      const nextJob: NotificationJob = {
        ...job,
        attempt: job.attempt + 1,
        enqueuedAt: retryAt.toISOString(),
      };
      await contactMessageDal.recordFailedAttempt(message.id, job.attempt, failure.message);
      await queueDal.retryLater(entry, JSON.stringify(nextJob), retryAt.getTime() + delayMs);
      jobLog.warn({ err: failure, retryInMs: delayMs }, 'notification failed, will retry');
      return 'retried';
    }

    // Postgres first: it is the source of truth. A crash before the DLQ write leaves the
    // message FAILED (docs/sql/contact.sql lists those) and the job is skipped on requeue.
    const reason = failure.retryable ? 'attempts_exhausted' : 'rejected';
    await contactMessageDal.markFailed(message.id, job.attempt, failure.message);
    await queueDal.deadLetter(entry, deadLetterEntry(entry, reason, failure.message));
    jobLog.error({ err: failure, reason }, 'notification failed for good, dead-lettered');
    return 'dead_lettered';
  }

  return {
    async processNext(log) {
      const stranded = await queueDal.requeueStranded();
      if (stranded > 0) {
        metrics.notificationJobsRequeued.inc({ reason: 'stranded' }, stranded);
        log.warn({ jobs: stranded }, 'requeued jobs left in processing by an earlier run');
      }

      const entry = await queueDal.take(TAKE_TIMEOUT_SECONDS);
      if (entry === null) {
        return 'idle';
      }
      const outcome = await run(entry, log);
      metrics.notificationJobs.inc({ outcome });
      return outcome;
    },

    async promoteDue(log) {
      const promoted = await queueDal.promoteDue(now().getTime(), PROMOTE_BATCH_SIZE);
      if (promoted > 0) {
        log.debug({ jobs: promoted }, 'delayed jobs ready to retry');
      }
      return promoted;
    },

    async reconcile(log) {
      const stale = await contactMessageDal.claimStalePending(
        STALE_AFTER_SECONDS,
        RECONCILE_BATCH_SIZE,
      );
      for (const message of stale) {
        const job: NotificationJob = {
          jobId: newJobId(),
          messageId: message.id,
          attempt: message.attempts + 1,
          enqueuedAt: now().toISOString(),
        };
        await queueDal.enqueue(JSON.stringify(job));
        metrics.notificationJobsRequeued.inc({ reason: 'reconciled' });
        log.warn(
          { messageId: message.id, jobId: job.jobId },
          'pending message had no job, re-queued',
        );
      }
      return stale.length;
    },
  };
}

/** One queue entry → a valid job, or the reason it is not one. */
function parseJob(entry: string): { job: NotificationJob } | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(entry);
  } catch {
    return { problem: 'not valid JSON' };
  }
  const result = notificationJobSchema.safeParse(json);
  if (result.success) {
    return { job: result.data };
  }
  return {
    problem: result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  };
}

/**
 * Notifiers throw NotificationError for every failure they know about. Anything else is a
 * bug in the notifier: retrying the same code would fail the same way, so it is not retryable.
 */
function asNotificationError(error: unknown): NotificationError {
  if (error instanceof NotificationError) {
    return error;
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new NotificationError(`notifier crashed: ${reason}`, { retryable: false, cause: error });
}
