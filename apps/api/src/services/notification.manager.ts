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

/** How long one `take` waits; short, so stopping never hangs. */
const TAKE_TIMEOUT_SECONDS = 5;
const PROMOTE_BATCH_SIZE = 100;
/** A PENDING message untouched this long has lost its job (DESIGN.md §8.3). */
const STALE_AFTER_SECONDS = 5 * 60;
const RECONCILE_BATCH_SIZE = 100;
/** Below STALE_AFTER_SECONDS, so a waiting retry never looks lost to the reconciler. */
export const MAX_RETRY_DELAY_MS = 4 * 60 * 1000;

/**
 * base × 2^(attempt − 1), ± 20 % jitter, capped at MAX_RETRY_DELAY_MS (defaults: ~5 s, ~10 s).
 * Jitter, so jobs that failed together don't all retry (and fail) together.
 */
export function retryDelayMs(failedAttempt: number, baseMs: number, random: () => number): number {
  const exponential = baseMs * 2 ** (failedAttempt - 1);
  const jitter = 0.8 + 0.4 * random(); // 0.8 to 1.2
  return Math.min(Math.round(exponential * jitter), MAX_RETRY_DELAY_MS);
}

/** One job's outcome, or `idle` when none came. */
export type ProcessOutcome = NotificationJobOutcome | 'idle';

/**
 * Notification jobs, queue to inbox (DESIGN.md §8.3); workers/ decide when. At least once: a
 * crash can repeat a notification, never drop one, and repeats check the message's status.
 */
export interface NotificationManager {
  /**
   * Takes the next job (waiting up to 5 s) and runs it. First puts back anything in
   * `processing`: with one consumer running one job at a time, it can only be a crash's leftover.
   */
  processNext: (log: Logger) => Promise<ProcessOutcome>;
  /** Delayed retries whose backoff is over → `ready`. */
  promoteDue: (log: Logger) => Promise<number>;
  /** Queues a job for every message PENDING over 5 minutes with no job. */
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
  /** For tests. */
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

  /** Runs one job; `entry` is its exact text, needed to remove it. */
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

    // The job may be a repeat (crash after sending, reconciler re-queue): only PENDING needs it.
    const message = await contactMessageDal.findById(job.messageId);
    if (message?.status !== 'PENDING') {
      await queueDal.complete(entry);
      jobLog.info({ status: message?.status ?? 'missing' }, 'notification job skipped');
      return 'skipped';
    }

    // Only the notifier's failure is caught. A Postgres or Redis failure below escapes on purpose:
    // the job stays in `processing` and is requeued after the outage, using up no attempts.
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

    // Postgres first, the source of truth. A crash before the DLQ write leaves the message FAILED
    // (docs/sql/contact.sql) and the job is skipped on requeue.
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

/** Entry → a valid job, or why it isn't one. */
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

/** Anything but a NotificationError is a notifier bug: retrying would fail the same way. */
function asNotificationError(error: unknown): NotificationError {
  if (error instanceof NotificationError) {
    return error;
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new NotificationError(`notifier crashed: ${reason}`, { retryable: false, cause: error });
}
