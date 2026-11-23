import { queueNameSchema } from '@portfolio/shared';
import { z } from 'zod';

/** GET /api/v1/admin/queues/:queue (DESIGN.md §7.8); the response schema is shared. */
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

/** A queue's count and up to `limit` entries as stored, taken out of nothing. */
export interface QueuePeek<Entry = string> {
  total: number;
  entries: Entry[];
}

/** A delayed retry and its score: when it's due (ms). */
export interface DelayedEntry {
  entry: string;
  dueAtMs: number;
}
