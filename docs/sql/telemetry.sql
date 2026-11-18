-- Phase 3: telemetry. Read-only queries about who visits the site and what they look at.
-- Open this file in VS Code, choose the "portfolio (dev)" connection, put the cursor on one
-- statement and run it. Guide: docs/DATA-TOOLS.md §7
-- The same information, summarised, is on the owner page: http://localhost:3000/admin
-- (password: ADMIN_TOKEN). These queries are for digging deeper.

-- The latest events, newest first, with everything we know about each visitor.
SELECT received_at, event_type, event_name, path, ref, utm_source, referrer_host,
       organization, city, country_code, browser, os, device_type, language, timezone
  FROM analytics_events
 ORDER BY received_at DESC
 LIMIT 50;

-- Most viewed pages in the last 7 days.
SELECT path, count(*) AS views, count(DISTINCT visitor_hash) AS visitors
  FROM analytics_events
 WHERE event_type = 'page_view'
   AND received_at > now() - interval '7 days'
 GROUP BY path
 ORDER BY views DESC;

-- Unique visitors per day. The visitor hash changes every UTC day, so a visitor counts once
-- per day, but the same person on two days cannot be linked.
SELECT received_at::date AS day, count(DISTINCT visitor_hash) AS visitors, count(*) AS events
  FROM analytics_events
 GROUP BY day
 ORDER BY day DESC;

-- Which organisations' networks visitors came from (companies with their own network show up
-- by name; people at home show up as their internet provider).
SELECT organization, country_code, count(DISTINCT session_id) AS sessions, max(received_at) AS last_seen
  FROM analytics_events
 WHERE organization IS NOT NULL
 GROUP BY organization, country_code
 ORDER BY last_seen DESC;

-- Tagged links: who opened a link like https://<site>/?ref=acme. The ref is only on the first
-- page of a visit, so this follows the session to show every page they viewed afterwards.
WITH tagged_sessions AS (
  SELECT DISTINCT session_id, ref
    FROM analytics_events
   WHERE ref IS NOT NULL
)
SELECT t.ref, e.received_at, e.event_type, coalesce(e.event_name, e.path) AS what,
       e.organization, e.city
  FROM tagged_sessions t
  JOIN analytics_events e USING (session_id)
 ORDER BY t.ref, e.received_at;

-- Where visitors come from: referring sites and UTM sources.
SELECT coalesce(referrer_host, '(direct)') AS referrer, utm_source, count(*) AS events
  FROM analytics_events
 GROUP BY referrer, utm_source
 ORDER BY events DESC;

-- Devices and browsers, without crawlers.
SELECT device_type, browser, os, count(*) AS events
  FROM analytics_events
 WHERE device_type IS DISTINCT FROM 'bot'
 GROUP BY device_type, browser, os
 ORDER BY events DESC;

-- Clicks (interactions) by name, e.g. click:github-link.
SELECT event_name, count(*) AS clicks, count(DISTINCT visitor_hash) AS visitors
  FROM analytics_events
 WHERE event_type = 'interaction'
 GROUP BY event_name
 ORDER BY clicks DESC;

-- Pipeline health: how long events waited in Redis before the worker inserted them.
SELECT count(*) AS events,
       round(avg(extract(epoch FROM inserted_at - received_at))::numeric, 2) AS avg_wait_seconds,
       round(max(extract(epoch FROM inserted_at - received_at))::numeric, 2) AS max_wait_seconds
  FROM analytics_events
 WHERE received_at > now() - interval '1 day';
