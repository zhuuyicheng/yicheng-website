import { z } from 'zod';
import { CONTACT_MESSAGE_STATUSES } from './contact.js';
import { EVENT_TYPES } from './events.js';
import { queueDepthsSchema } from './system-status.js';

/**
 * GET /api/v1/admin/queues/:queue?limit=20 (DESIGN.md §7.8): what waits in one of the Redis
 * queues counted by the status report (§7.7), read without taking anything out. Owner-only,
 * for the queue card on /admin: which visits are not saved yet, whose message you have not
 * been told about, and why a dead letter failed.
 */

/** The queues, by the same names as their counts in the status report. */
export const queueNameSchema = queueDepthsSchema.keyof();
export type QueueName = z.infer<typeof queueNameSchema>;

export const QUEUE_ITEMS_LIMIT = { default: 20, max: 100 } as const;

export const queueItemsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(QUEUE_ITEMS_LIMIT.max)
    .default(QUEUE_ITEMS_LIMIT.default),
});

const text = z.string().nullable();

/** A page view or click on its way to the database (or one that could not be saved). */
export const queuedEventSchema = z.object({
  id: z.string(),
  type: z.enum(EVENT_TYPES),
  /** A click's link, e.g. `click:linkedin`; null for a page view. */
  name: text,
  path: z.string(),
  receivedAt: z.string(),
  /** The site the visitor came from (host only). */
  referrer: text,
  organization: text,
  city: text,
  countryCode: text,
  deviceType: text,
  browser: text,
  os: text,
});
export type QueuedEvent = z.infer<typeof queuedEventSchema>;

/** The contact message a notification is about, as the database holds it. */
export const queuedMessageSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  message: z.string(),
  status: z.enum(CONTACT_MESSAGE_STATUSES),
  /** Why the last try to tell you failed, if one did. */
  lastError: text,
  createdAt: z.string(),
});
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;

/**
 * Why the worker gave up (DESIGN.md §8.2, §8.3). Visits: `insert_failed` (the database refused
 * the row) or `invalid_payload` (unreadable). Notifications: `rejected` (Discord refused it,
 * usually a wrong or deleted webhook), `attempts_exhausted` (every retry failed) or
 * `invalid_payload`.
 */
export const deadLetterReasonSchema = z.enum([
  'insert_failed',
  'rejected',
  'attempts_exhausted',
  'invalid_payload',
]);
export type DeadLetterReasonName = z.infer<typeof deadLetterReasonSchema>;

export const deadLetterSchema = z.object({
  reason: deadLetterReasonSchema,
  /** What went wrong, in the words of the database or of Discord. */
  error: z.string(),
  /** The database's error code (SQLSTATE, e.g. `23514`) when it refused a visit, else null. */
  errorCode: text,
  failedAt: z.string(),
});
export type DeadLetter = z.infer<typeof deadLetterSchema>;

export const queueItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    /** null when the entry cannot be read: `raw` then shows how it starts. */
    event: queuedEventSchema.nullable(),
    /** Dead-letter lists only. */
    deadLetter: deadLetterSchema.nullable(),
    raw: text,
  }),
  z.object({
    kind: z.literal('notification'),
    /** Which try this is (1 = the first); null when the job cannot be read. */
    attempt: z.number().int().positive().nullable(),
    /** Retries waiting out their delay only: when the next try is due. */
    dueAt: text,
    /** null when the job cannot be read, or its message no longer exists. */
    message: queuedMessageSchema.nullable(),
    /** Dead-letter lists only. */
    deadLetter: deadLetterSchema.nullable(),
    raw: text,
  }),
]);
export type QueueItem = z.infer<typeof queueItemSchema>;

export const queueItemsSchema = z.object({
  queue: queueNameSchema,
  /** How many items the queue holds right now. */
  total: z.number().int().nonnegative(),
  /** At most `limit` of them, newest first (retries waiting: the next due first). */
  items: z.array(queueItemSchema),
  generatedAt: z.string(),
});
export type QueueItems = z.infer<typeof queueItemsSchema>;
