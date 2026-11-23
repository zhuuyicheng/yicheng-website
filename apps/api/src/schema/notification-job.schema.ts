import { z } from 'zod';

/**
 * Notification jobs (DESIGN.md §6.6, §8.3). A job holds ids only; the message stays in
 * Postgres. The worker validates each job: queued data can be old or corrupt.
 */

// Job

export const notificationJobSchema = z.object({
  /** For logs. A retry keeps it; a reconciler re-queue gets a new one. */
  jobId: z.uuid(),
  messageId: z.uuid(),
  /** 1 for the first try; a retry is the same job with `attempt + 1`. */
  attempt: z.int().min(1),
  /** When this attempt was queued. */
  enqueuedAt: z.iso.datetime(),
});

export type NotificationJob = z.infer<typeof notificationJobSchema>;

// Dead letter

/**
 * `invalid_payload`: not a valid job. `rejected`: the notifier refused it for good (e.g. 404).
 * `attempts_exhausted`: failed NOTIFY_MAX_ATTEMPTS times.
 */
export const DEAD_LETTER_REASONS = ['invalid_payload', 'rejected', 'attempts_exhausted'] as const;
export type JobDeadLetterReason = (typeof DEAD_LETTER_REASONS)[number];

export const deadLetteredJobSchema = z.object({
  /** The entry exactly as taken, so nothing is lost even if it isn't valid JSON. */
  payload: z.string(),
  reason: z.enum(DEAD_LETTER_REASONS),
  error: z.string(),
  failedAt: z.iso.datetime(),
});

export type DeadLetteredJob = z.infer<typeof deadLetteredJobSchema>;
