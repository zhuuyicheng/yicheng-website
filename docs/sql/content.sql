-- Phase 2: portfolio content. Read-only queries to explore the data.
-- Open this file in VS Code, choose the "portfolio (dev)" connection, put the cursor on one
-- statement and run it. Guide: docs/DATA-TOOLS.md

-- Which migrations have been applied?
SELECT version, name, applied_at
  FROM schema_migrations
 ORDER BY version;

-- Projects in display order (what GET /api/v1/projects returns).
SELECT slug, title, featured, sort_order, updated_at
  FROM projects
 ORDER BY featured DESC, sort_order, slug;

-- Experiences in display order (part of GET /api/v1/profile).
SELECT company, role, start_date, end_date, sort_order
  FROM experiences
 ORDER BY sort_order, start_date DESC;

-- The profile (always exactly one row once seeded).
SELECT full_name, headline, location, jsonb_pretty(links) AS links, updated_at
  FROM profile;

-- Row counts per table.
SELECT relname AS table_name, n_live_tup AS approx_rows
  FROM pg_stat_user_tables
 ORDER BY relname;

-- Who is connected right now? Each process sets its own application_name
-- (portfolio-api, portfolio-seed, portfolio-migrator, ...).
SELECT application_name, state, backend_start, left(query, 80) AS last_query
  FROM pg_stat_activity
 WHERE datname = current_database();
