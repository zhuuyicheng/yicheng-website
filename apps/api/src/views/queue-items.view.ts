import type { QueueItems } from '../schema/queue-items.schema.js';
import type { DataResponseBody } from './data.view.js';

/** Built field by field for this response (and checked by its schema in tests), so sent as is. */
export function renderQueueItems(items: QueueItems): DataResponseBody<QueueItems> {
  return { data: items };
}
