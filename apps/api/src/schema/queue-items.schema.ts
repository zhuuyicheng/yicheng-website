import { queueNameSchema } from '@portfolio/shared';
import { z } from 'zod';

/**
 * GET /api/v1/admin/queues/:queue (DESIGN.md §7.8). The response is the public contract (the
 * web app's /admin queue card parses it), so its schema lives in `@portfolio/shared`.
 */
export {
  queueItemsQuerySchema,
  type DeadLetter,
  type QueueItem,
  type QueueItems,
  type QueueName,
  type QueuedEvent,
  type QueuedMessage,
} from '@portfolio/shared';

export const queueItemsParamsSchema = z.object({ queue: queueNameSchema });

/**
 * A look into a queue without taking anything out (the DALs' `peek…` methods): how many
 * entries it holds, and up to the requested number of them, as stored.
 */
export interface QueuePeek<Entry = string> {
  total: number;
  entries: Entry[];
}

/** A retry waiting in `jobs:notifications:delayed`, with its score: when it is due (ms). */
export interface DelayedEntry {
  entry: string;
  dueAtMs: number;
}
