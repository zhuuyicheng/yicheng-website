/**
 * Row type for `analytics_events` (migration 0003), column for column. The flusher (Phase 3,
 * step 4) writes these rows in batches; Phase 5's dashboard reads them.
 */
export interface AnalyticsEventRow {
  /** Assigned at ingestion, so re-inserting the same event is a no-op (`ON CONFLICT`). */
  id: string;
  event_type: 'page_view' | 'interaction';
  /** Set for interactions only (enforced by a CHECK constraint). */
  event_name: string | null;
  path: string;
  referrer_host: string | null;
  session_id: string;
  visitor_hash: string;
  received_at: Date;
  inserted_at: Date;
}
