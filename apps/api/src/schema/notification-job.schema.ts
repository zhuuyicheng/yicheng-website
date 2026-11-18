import { z } from 'zod';

/**
 * A notification job: "tell the site owner about contact message `messageId`". It lives in the
 * Redis job queues (`jobs:notifications:*`, DESIGN.md §6.2) as JSON. The message itself stays
 * in Postgres, so a job carries ids only, never the visitor's name, email or text.
 *
 * The worker validates each job it takes with this schema: queued data can be older than the
 * code reading it, or simply corrupt.
 */
export const notificationJobSchema = z.object({
  /** Unique per job, so two jobs for the same message are still different queue entries. */
  jobId: z.uuid(),
  messageId: z.uuid(),
  /** 1 for the first try; a retry is a new job with `attempt + 1`. */
  attempt: z.int().min(1),
  enqueuedAt: z.iso.datetime(),
});

export type NotificationJob = z.infer<typeof notificationJobSchema>;
