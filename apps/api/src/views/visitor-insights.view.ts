import type { VisitorSummary } from '../schema/visitor-insights.schema.js';
import type { DataResponseBody } from './data.view.js';

/**
 * The summary is built field by field by the manager for this response alone, and validated
 * by its shared schema in the tests, so it is sent as it is.
 */
export function renderVisitorSummary(summary: VisitorSummary): DataResponseBody<VisitorSummary> {
  return { data: summary };
}
