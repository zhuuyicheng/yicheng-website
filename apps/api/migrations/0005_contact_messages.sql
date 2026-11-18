-- Contact form: one row per message sent through POST /api/v1/contact.
-- Postgres is the source of truth; the Redis job queue only says "notify about this row".
-- The sender's IP is never stored, only a keyed hash (HMAC) of it, for abuse investigations.

CREATE TABLE contact_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  email       TEXT        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  message     TEXT        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  ip_hash     TEXT        NOT NULL,             -- HMAC-SHA256(IP_HASH_SECRET, ip)
  status      TEXT        NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts    INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),   -- notification attempts
  last_error  TEXT,                             -- why the last notification attempt failed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);

-- Reconciler scan: small partial index containing only unfinished messages.
CREATE INDEX contact_messages_pending_idx ON contact_messages (updated_at) WHERE status = 'PENDING';
-- "Latest messages first" when reading them.
CREATE INDEX contact_messages_created_at_idx ON contact_messages (created_at DESC);
