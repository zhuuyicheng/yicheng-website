import type { VisitorSummary } from '../schema/visitor-insights.schema.js';
import type { DataResponseBody } from './data.view.js';

/** Built field by field for this response (and checked by its schema in tests), so sent as is. */
export function renderVisitorSummary(summary: VisitorSummary): DataResponseBody<VisitorSummary> {
  return { data: summary };
}
