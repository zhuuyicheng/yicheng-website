# Seeing the Data: PostgreSQL & Redis in VS Code

Logs and `curl` tell you _that_ something happened. These two extensions let you _see_ it: rows
appearing in Postgres, keys appearing (and expiring) in Redis. Every phase adds a section to
§7 of this guide describing what to watch.

| Extension                                        | Publisher | Shows                                                        |
| ------------------------------------------------ | --------- | ------------------------------------------------------------ |
| **PostgreSQL** (`ms-ossdata.vscode-pgsql`)       | Microsoft | Databases, tables and rows; runs SQL files; schema diagrams  |
| **Redis for VS Code** (`redis.redis-for-vscode`) | Redis     | Keys as a tree, their type, value and TTL; a Redis CLI panel |

Both are listed in [`.vscode/extensions.json`](../.vscode/extensions.json), so VS Code offers to
install them when you open the repo on a new machine.

---

## 1. One-time setup

Start the datastores first: `npm run infra:up`.

> **Use `127.0.0.1`, not `localhost`.** Docker publishes our ports on the IPv4 loopback address
> only (see `docker-compose.yml`). `localhost` can resolve to the IPv6 address `::1`, where
> nothing is listening, which shows up as "connection refused".

### 1.1 PostgreSQL: two connections

1. Click the **elephant icon** in the left Activity Bar → **Add Connection** (`+`).
2. Fill in the form:

   | Field               | Value                              |
   | ------------------- | ---------------------------------- |
   | Server name         | `127.0.0.1`                        |
   | Port                | `5432`                             |
   | Authentication type | Password                           |
   | User name           | `portfolio`                        |
   | Password            | `portfolio` (tick "Save password") |
   | Database name       | `portfolio`                        |
   | Profile name        | `portfolio (dev)`                  |

3. **Connect.** The connection appears in the tree.
4. Repeat with database `portfolio_test` and profile name `portfolio (tests)`.

The values come from `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`). They are
local-development credentials only.

### 1.2 Redis: two logical databases

Redis has numbered "logical databases" inside one server. We use **DB 0** for development and
**DB 1** for tests, so tests can wipe their data without touching yours.

1. Click the **Redis icon** in the Activity Bar → **+ Add Redis database**
   (or "Connect database").
2. Host `127.0.0.1`, port `6379`, alias `portfolio (dev, DB 0)`. Leave username and password
   empty (local Redis has none). Database index: `0`.
3. Add a second one: alias `portfolio (tests, DB 1)`, database index `1` (look for "Select
   logical database" / "Database index" in the form).

---

## 2. What lives where

| Phase | PostgreSQL (database `portfolio`)    | Redis (DB 0)                                                         |
| ----- | ------------------------------------ | -------------------------------------------------------------------- |
| 1     | `schema_migrations`                  | —                                                                    |
| 2     | `profile`, `experiences`, `projects` | `cache:v1:profile`, `cache:v1:projects`, `cache:v1:project:<slug>`   |
| 3     | `analytics_events`                   | `telemetry:events:buffer` / `:inflight` / `:dlq`, `telemetry:salt:*` |
| 4     | `contact_messages`                   | `ratelimit:contact:<hash>`, `jobs:notifications:*`                   |

Full key catalog: DESIGN.md §6.2. Tables: DESIGN.md §5.

---

## 3. Tour of the PostgreSQL extension

- **Browse**: `portfolio (dev)` → Databases → `portfolio` → Schemas → `public` → Tables.
  Expand a table to see its columns and indexes, e.g. `projects_display_order_idx`.
- **See rows**: right-click a table → **Select Top 1000**. The result grid opens in a panel.
- **Run saved queries**: open [`docs/sql/content.sql`](sql/content.sql), pick the
  `portfolio (dev)` connection when asked (or from the status bar), put the cursor on one
  statement and press the **Run** (▷) button at the top of the editor.
- **Schema diagram**: right-click the `portfolio` database → **Visualize Schema** (if your
  extension version has it) to see the tables and their columns as a diagram.
- **Who is connected**: the last query in `content.sql` lists connections by
  `application_name`. You will see `portfolio-api` while `npm run dev:api` runs; that name is
  set in `src/main.ts` so connections are easy to tell apart.

## 4. Tour of Redis for VS Code

- **Key tree**: keys are grouped into folders by `:`, so `cache:v1:projects` appears under
  `cache ▸ v1`. The tree does **not** update by itself: press the **refresh** button after
  each experiment.
- **Key details**: click a key to see its type (STRING, LIST, ZSET…), its **TTL** (seconds
  until Redis deletes it; `-1` = never) and its value. Switch the value view to **JSON** to
  read cached responses comfortably.
- **Edit / delete**: the trash icon deletes a key. Deleting a cache key is harmless (the next
  request rebuilds it); from Phase 3 on, deleting `telemetry:*` or `jobs:*` keys loses data.
- **Redis CLI panel**: the bottom panel has a **Redis CLI** tab for typed commands such as
  `TTL cache:v1:projects` or `SCAN 0 MATCH cache:*`.

### A live feed of every Redis command: `MONITOR`

The extension shows the _state_ of Redis. To see the _traffic_, run this in a spare terminal:

```bash
docker compose exec redis redis-cli MONITOR
```

Every command any client sends is printed as it happens, e.g.
`[0 172.18.0.1:51234] "get" "cache:v1:projects"`. Press Ctrl+C to stop. (Development only:
`MONITOR` slows Redis down.)

---

## 5. Walkthrough: watch a cache miss become a hit (Phase 2)

Arrange three things side by side: the Redis view, a terminal running `MONITOR`, and a
terminal for `curl`. Run `npm run dev:api` in a fourth terminal.

1. **Start empty.** In the Redis view, delete `cache:v1:projects` and refresh.
2. **First request (miss).**
   ```bash
   curl -si localhost:4000/api/v1/projects | grep -i x-cache    # x-cache: miss
   ```
   `MONITOR` shows `"get" "cache:v1:projects"` (nothing there), then
   `"set" "cache:v1:projects" "[{...}]" "EX" "296"`: the API loaded from Postgres and saved
   the result with a jittered TTL.
3. **Refresh the Redis view.** The key is back. Click it: TTL ≈ 300 and counting down; the
   value is exactly the `data` array the API returned.
4. **Second request (hit).** Same `curl` → `x-cache: hit`. `MONITOR` shows only the `get`.
   Postgres was not touched.
5. **Publish an edit.** Change a project title in `apps/api/content/portfolio.json`, then run
   `npm run content:seed`.
   - Postgres: re-run "Select Top 1000" on `projects`: the new title and a new `updated_at`.
   - `MONITOR`: a `scan` for `cache:v1:project:*`, one `del` of every content key, then a
     `get` (miss) + `set` pair per key as the seed warms the cache.
   - Redis view (refresh): all content keys exist again with fresh TTLs and the new title.
6. **Corrupt the cache.** Edit the value of `cache:v1:projects` in the Redis view to `oops`,
   then `curl` again: `x-cache: miss`, the API logs `cache operation failed` with
   `operation: "decode"`, and the key holds valid JSON again.

## 6. Looking at test data

Integration tests use the `portfolio (tests)` connection and `portfolio (tests, DB 1)`.
After `npm run test:integration` you can inspect what the last test left behind. Tests empty
these databases freely, so anything you change there will be overwritten.

## 7. What to watch in later phases

Each phase extends this section when it lands.

- **Phase 3 (telemetry):** `telemetry:events:buffer` (a LIST) grows as events arrive and
  empties every few seconds; rows appear in `analytics_events` at the same moment. Stop
  Postgres and watch the buffer grow instead of losing events.
- **Phase 4 (contact):** each accepted contact request adds a timestamped member to a
  `ratelimit:contact:<hash>` sorted set with a TTL; `contact_messages.status` moves from
  `PENDING` to `SENT` (or to `FAILED` with jobs in `jobs:notifications:dlq`).
- **Phase 5 (dashboard):** the live dashboard shows the same numbers you have been reading by
  hand here.

## 8. Troubleshooting

| Symptom                           | Fix                                                                   |
| --------------------------------- | --------------------------------------------------------------------- |
| "Connection refused"              | `npm run infra:up`; use `127.0.0.1` instead of `localhost`            |
| Connects, but no tables           | `npm run db:migrate` (and `npm run content:seed` for content rows)    |
| Redis view shows no `cache:` keys | Make sure the connection uses DB **0**, make a request, press refresh |
| `portfolio_test` database missing | It is created by the first `npm run test:integration`                 |
