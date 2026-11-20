/**
 * Row type for `analytics_events` (migrations 0003, 0004 and 0007), column for column. The worker's
 * flusher writes these rows in batches (dal/analytics-event.dal.ts).
 */
export interface AnalyticsEventRow {
  /** Assigned at ingestion, so re-inserting the same event is a no-op (`ON CONFLICT`). */
  id: string;
  event_type: 'page_view' | 'interaction';
  /** Set for interactions only (enforced by a CHECK constraint). */
  event_name: string | null;
  /** Query string and fragment stripped; campaign parameters have their own columns. */
  path: string;
  referrer_host: string | null;
  session_id: string;
  visitor_hash: string;
  received_at: Date;
  inserted_at: Date;

  // 0004: from the link
  ref: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  // 0004: from the browser
  browser: string | null;
  os: string | null;
  device_type: string | null;
  language: string | null;
  timezone: string | null;
  // 0004: from the IP address
  country_code: string | null;
  city: string | null;
  organization: string | null;
  // 0007: the address itself (pg returns INET as text, e.g. '203.0.113.7' or '2001:db8::1')
  ip_address: string | null;
}
