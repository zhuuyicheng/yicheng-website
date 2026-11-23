/** `analytics_events` (migrations 0003, 0004, 0007), column for column. */
export interface AnalyticsEventRow {
  /** Set at ingestion, so re-inserting an event is a no-op. */
  id: string;
  event_type: 'page_view' | 'interaction';
  /** Interactions only (a CHECK enforces it). */
  event_name: string | null;
  /** Without query string or fragment; campaign parameters have their own columns. */
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
  // 0007: the address itself (INET, as text)
  ip_address: string | null;
}
