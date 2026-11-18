import { z } from 'zod';

/**
 * Notification jobs. See DESIGN.md §6.6 and §8.3.
 *
 * Shapes:
 *   1. `NotificationJob`: "tell the site owner about contact message `messageId`", queued in
 *      Redis (`jobs:notifications:*`) as JSON. The message itself stays in Postgres, so a job
 *      carries ids only, never the visitor's name, email or text.
 *   2. `DeadLetteredJob`: a job the worker gave up on, kept in `jobs:notifications:dlq`.
 *
 * The worker validates each job it takes: queued data can be older than the code reading it,
 * or simply corrupt.
 */

// ---------------------------------------------------------------------------------------------
// 1. Job
// ---------------------------------------------------------------------------------------------

export const notificationJobSchema = z.object({
  /** Identifies the job in logs. A retry keeps it; a re-queue by the reconciler gets a new one. */
  jobId: z.uuid(),
  messageId: z.uuid(),
  /** 1 for the first try; a retry is the same job with `attempt + 1`. */
  attempt: z.int().min(1),
  /** When this attempt was queued. */
  enqueuedAt: z.iso.datetime(),
});

export type NotificationJob = z.infer<typeof notificationJobSchema>;

// ---------------------------------------------------------------------------------------------
// 2. Dead letter
// ---------------------------------------------------------------------------------------------

/**
 * Why a job was dead-lettered:
 *   - `invalid_payload`: the queue entry is not a valid job (corrupt, or from incompatible code);
 *   - `rejected`: the notifier refused it in a way retrying cannot fix (e.g. HTTP 404);
 *   - `attempts_exhausted`: it failed NOTIFY_MAX_ATTEMPTS times in a row.
 */
export const DEAD_LETTER_REASONS = ['invalid_payload', 'rejected', 'attempts_exhausted'] as const;
export type JobDeadLetterReason = (typeof DEAD_LETTER_REASONS)[number];

export const deadLetteredJobSchema = z.object({
  /** The queue entry exactly as it was taken, so nothing is lost even if it is not valid JSON. */
  payload: z.string(),
  reason: z.enum(DEAD_LETTER_REASONS),
  error: z.string(),
  failedAt: z.iso.datetime(),
});

export type DeadLetteredJob = z.infer<typeof deadLetteredJobSchema>;
