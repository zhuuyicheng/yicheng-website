-- Portfolio content: one profile, a list of experiences, a list of projects.
-- Written only by `npm run content:seed` (from content/portfolio.json); read by the content API.

CREATE TABLE profile (
  id          SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- singleton row
  full_name   TEXT        NOT NULL,
  headline    TEXT        NOT NULL,
  summary     TEXT        NOT NULL,
  location    TEXT,
  links       JSONB       NOT NULL DEFAULT '[]'::jsonb,           -- [{ "label": "...", "url": "..." }]
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE experiences (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company     TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  start_date  DATE        NOT NULL,
  end_date    DATE,                                               -- NULL = current role
  highlights  TEXT[]      NOT NULL DEFAULT '{}',
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT experiences_dates_ordered CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX experiences_display_order_idx ON experiences (sort_order, start_date DESC);

CREATE TABLE projects (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title        TEXT        NOT NULL,
  summary      TEXT        NOT NULL,
  description  TEXT        NOT NULL,
  tech_stack   TEXT[]      NOT NULL DEFAULT '{}',
  repo_url     TEXT,
  live_url     TEXT,
  featured     BOOLEAN     NOT NULL DEFAULT false,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_display_order_idx ON projects (featured DESC, sort_order);
