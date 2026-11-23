import type { QueueItems } from '../schema/queue-items.schema.js';
import type { DataResponseBody } from './data.view.js';

/**
 * The items are built field by field by the manager for this response alone, and validated by
 * their shared schema in the tests, so they are sent as they are.
 */
export function renderQueueItems(items: QueueItems): DataResponseBody<QueueItems> {
  return { data: items };
}
