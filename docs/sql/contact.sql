-- Contact messages, read-only. In VS Code: pick the "portfolio (dev)" connection, put the
-- cursor on a statement and run it (docs/DATA-TOOLS.md §7).

-- The latest messages, newest first, with their notification status.
SELECT created_at, name, email, left(message, 80) AS message_start, status, attempts, sent_at
  FROM contact_messages
 ORDER BY created_at DESC
 LIMIT 50;

-- Messages per state. PENDING should only be the last few minutes' worth.
SELECT status, count(*) AS messages, max(created_at) AS latest
  FROM contact_messages
 GROUP BY status;

-- PENDING after 5 minutes: exactly what the reconciler re-queues.
SELECT id, created_at, updated_at, attempts, last_error
  FROM contact_messages
 WHERE status = 'PENDING'
   AND updated_at < now() - interval '5 minutes'
 ORDER BY updated_at;

-- Notifications that failed for good, and why (their jobs: jobs:notifications:dlq).
SELECT id, created_at, attempts, last_error
  FROM contact_messages
 WHERE status = 'FAILED'
 ORDER BY created_at DESC;

-- Senders with several messages. ip_hash is keyed: it groups by IP without revealing it.
SELECT left(ip_hash, 12) AS sender, count(*) AS messages, min(created_at) AS first, max(created_at) AS last
  FROM contact_messages
 GROUP BY ip_hash
HAVING count(*) > 1
 ORDER BY messages DESC;
