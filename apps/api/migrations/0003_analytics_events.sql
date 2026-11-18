-- Telemetry: one row per page view or interaction, written in batches by the worker's flusher.
-- Append-only. Raw IPs and user agents are never stored, only a daily-salted hash.

CREATE TABLE analytics_events (
  id             UUID        PRIMARY KEY,          -- assigned at ingestion → idempotent replays
  event_type     TEXT        NOT NULL CHECK (event_type IN ('page_view', 'interaction')),
  event_name     TEXT,                             -- e.g. 'click:github-link'; interactions only
  path           TEXT        NOT NULL,             -- query string stripped
  referrer_host  TEXT,                             -- host only, never the full URL
  session_id     TEXT        NOT NULL,             -- opaque, client-generated
  visitor_hash   TEXT        NOT NULL,             -- sha256(daily_salt + ip + user_agent)
  received_at    TIMESTAMPTZ NOT NULL,             -- server time at ingestion
  inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT analytics_events_name_iff_interaction
    CHECK ((event_type = 'interaction') = (event_name IS NOT NULL))
);

-- Append-only, time-ordered data: a BRIN index is tiny and ideal for "last 24 hours" scans.
CREATE INDEX analytics_events_received_at_brin ON analytics_events USING BRIN (received_at);
-- Per-page breakdowns ("top pages this week").
CREATE INDEX analytics_events_path_received_at_idx ON analytics_events (path, received_at DESC);
