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

### 1.1 PostgreSQL

1. Click the **elephant icon** in the left Activity Bar → **Add Connection** (`+`).
2. Switch to the **Connection String** tab and paste:

   ```
   postgresql://portfolio:portfolio@127.0.0.1:5432/portfolio
   ```

   Read it as `scheme://user:password@host:port/database`. It is the same format as
   `DATABASE_URL` in `.env`, and the values come from `POSTGRES_USER`, `POSTGRES_PASSWORD` and
   `POSTGRES_DB` there. They are local-development credentials only.

3. Set **Connection name** to `portfolio (dev)`, then **Test Connection** → **Save & Connect**.

Prefer the **Parameters** tab? Use the same values, set **Authentication type** to
**Password** (not "None"), and tick **Save password**. Port is under **Advanced** and already
defaults to `5432`.

**Optional second connection, for the tests.** The same server also holds a database called
`portfolio_test`. Integration tests empty and refill its tables on every run, which is why they
never touch your real content in `portfolio`. Add it the same way (ending the string with
`/portfolio_test`, name `portfolio (tests)`) only if you want to see what a test left behind.

> **"password authentication failed"?** The extension keeps retrying a saved connection with
> the credentials it was first saved with, so fixing the form doesn't help. Delete the
> connection from the sidebar and add it again.

### 1.2 Redis: two logical databases

Redis has numbered "logical databases" inside one server. We use **DB 0** for development and
**DB 1** for tests, so tests can wipe their data without touching yours.

1. Click the **Redis icon** in the Activity Bar → **+ Add Redis database**
   (or "Connect database").
2. Host `127.0.0.1`, port `6379`, alias `portfolio (dev, DB 0)`. Leave username and password
   empty (local Redis has none). No database setting is needed: Redis uses DB 0 by default.
3. That one connection is all you need. Redis for VS Code (1.4) has no logical-database option,
   so every connection it adds shows DB 0, which is where all dev data lives. To peek at the
   tests' DB 1 (usually empty, because tests clear it when they start), use the terminal:
   `docker compose exec redis redis-cli -n 1 KEYS '*'`.

---

## 2. What lives where

| Phase | PostgreSQL (database `portfolio`)                              | Redis (DB 0)                                                         |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1     | `schema_migrations`                                            | —                                                                    |
| 2     | `profile`, `experiences`, `education`, `projects`              | `cache:v3:profile`, `cache:v1:projects`, `cache:v3:project:<slug>`   |
| 3     | `analytics_events`                                             | `telemetry:events:buffer` / `:inflight` / `:dlq`, `telemetry:salt:*` |
| 4     | `contact_messages`                                             | `ratelimit:contact:<hash>`, `jobs:notifications:*`                   |
| 5     | — (the website fills the tables above via the API)             | — (the status endpoint reads queue lengths)                          |
| 6     | new columns `projects.sections`, `analytics_events.ip_address` | — (a project's cache key became `v2`, for its sections)              |

Full key catalog: DESIGN.md §6.2. Tables: DESIGN.md §5.

---

## 3. Tour of the PostgreSQL extension

- **Browse**: `portfolio (dev)` → Databases → `portfolio` → Schemas → `public` → Tables.
  Expand a table to see its columns and indexes, e.g. `projects_display_order_idx`.
- **See rows**: right-click a table → **Select Top 1000**. The result grid opens in a panel.
- **Run saved queries**: open [`docs/sql/content.sql`](sql/content.sql) (or, from Phase 3,
  [`docs/sql/telemetry.sql`](sql/telemetry.sql)), pick the `portfolio (dev)` connection when
  asked (or from the status bar), put the cursor on one statement and press the **Run** (▷)
  button at the top of the editor.
- **Schema diagram**: right-click the `portfolio` database → **Visualize Schema** (if your
  extension version has it) to see the tables and their columns as a diagram.
- **Who is connected**: the last query in `content.sql` lists connections by
  `application_name`. You will see `portfolio-api` while `npm run dev:api` runs and
  `portfolio-worker` while `npm run dev:worker` runs; those names are set in `src/main.ts` and
  `src/worker.ts` so connections are easy to tell apart.

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
5. **Publish an edit.** Change a project title in `apps/api/content/portfolio.json`, **save
   it** (`Ctrl+S`; the seed reads the file from disk, not your editor), then run
   `npm run content:seed`.
   - Postgres: re-run "Select Top 1000" on `projects`: the new title, and a new `updated_at`
     on that row only. The other rows keep theirs, and so does every row if you seed again
     without changing the file (the seed logs `"changed":false`). That `updated_at` is the
     project page's "Last updated" date.
   - `MONITOR`: a `scan` for `cache:v3:project:*`, one `del` of every content key, then a
     `get` (miss) + `set` pair per key as the seed warms the cache.
   - Redis view: click ↻ on the database row to reload the key list, then click the key
     again (the value panel shows what it loaded last time). Fresh TTLs and the new title.
6. **Corrupt the cache.** Edit the value of `cache:v1:projects` in the Redis view to `oops`,
   then `curl` again: `x-cache: miss`, the API logs `cache operation failed` with
   `operation: "decode"`, and the key holds valid JSON again.

## 6. Looking at test data

Integration tests use the `portfolio_test` database (connection `portfolio (tests)`) and Redis
DB 1 (`docker compose exec redis redis-cli -n 1 KEYS '*'`). After `npm run test:integration`
you can inspect what the last test left behind. Tests empty these databases freely, so anything
you change there will be overwritten.

## 7. What to watch, phase by phase

Each phase extends this section when it lands.

### 7.1 Phase 3: the telemetry pipeline

The path of one event (DESIGN.md §8.2):

```
curl / browser ─► API ─► telemetry:events:buffer ─► worker claims a batch ─► analytics_events
                         (Redis LIST)                telemetry:events:inflight   (Postgres)
                                                     bad events ─► telemetry:events:dlq
```

Arrange four terminals: `npm run dev:api`, `npm run dev:worker`, `MONITOR` (§4), and one for
`curl`. Keep the Redis view and the `analytics_events` table open. Remember ↻ in the Redis view.

1. **Drain what is already waiting.** Before you start the worker, click
   `telemetry:events:buffer` in the Redis view: any events sent while no worker was running
   are still there, because nothing consumed them. Now start `npm run dev:worker`. Its
   log says `worker started`, then `telemetry batch flushed` with `claimed` and `inserted`
   counts. Refresh: the buffer key is gone (Redis deletes empty lists). Select Top 1000 on
   `analytics_events`: the rows are there. Events sent before migration 0004 have empty visitor
   details, because the old code did not collect them.
2. **Send one event with everything filled in.**

   ```bash
   curl -s -X POST localhost:4000/api/v1/events -H 'content-type: application/json' \
     -H 'accept-language: en-SG,en;q=0.9' \
     -d '{"type":"page_view","path":"/?ref=acme&utm_source=linkedin","sessionId":"mySession001","timezone":"Asia/Singapore"}'
   ```

   `MONITOR` shows the API's `evalsha` (the bounded-enqueue script) and, on lines marked
   `[0 lua]`, the `LLEN` and `RPUSH` the script ran. Within 5 s (`TELEMETRY_FLUSH_INTERVAL_MS`)
   the worker's `evalsha` (claim) runs `LRANGE`, `LTRIM` and `RPUSH` into
   `telemetry:events:inflight`, then a `del` of the in-flight list once Postgres has the row.
   The new row has `ref = acme`, `utm_source = linkedin`, `language = en-SG` and
   `timezone = Asia/Singapore`. `browser` stays empty: curl's user agent is not a browser.

3. **See who a visitor is (organisation and location).** Locally every request comes from
   `127.0.0.1`, which no IP database knows, so `organization`, `city` and `country_code` stay
   empty. To try the lookup, restart the API pretending to be behind a proxy, and claim to be
   someone else (never do this in production without a real proxy):

   ```bash
   TRUST_PROXY=true npm run dev:api        # an env var beats the .env file
   curl -s -X POST localhost:4000/api/v1/events -H 'content-type: application/json' \
     -H 'x-forwarded-for: 8.8.8.8' -d '{"type":"page_view","path":"/","sessionId":"mySession001"}'
   ```

   The row says `US`, `Mountain View`, `Google LLC`. This needs the GeoIP files
   (`npm run geoip:download`) and the `GEOIP_*_DB_PATH` lines from `.env.example`.

4. **Postgres goes down: nothing is lost.** `docker compose stop postgres`, then send a few
   events: still `202`, because ingestion never touches Postgres. The worker logs
   `telemetry flush failed: datastore unavailable, will retry` with `retryInMs` doubling (500,
   1000, 2000…). In the Redis view, `telemetry:events:inflight` holds the batch it is retrying
   and `telemetry:events:buffer` keeps growing. `docker compose start postgres`: within the
   current backoff (at most 30 s) the worker inserts the in-flight batch, then the rest.
5. **A poison event goes to the DLQ.** In the Redis CLI panel run
   `RPUSH telemetry:events:buffer "not json"`. The worker logs `telemetry event dead-lettered`
   (`reason: invalid_payload`) and `telemetry:events:dlq` appears; its value shows the original
   payload, the reason and the error message. `npm run dlq:replay -- telemetry` moves it back
   to the buffer, and since it is still not JSON, the worker dead-letters it again. That is the
   intended loop: fix the cause first, then replay. Delete the DLQ key when you are done.
6. **Graceful shutdown drains the buffer.** Restart the worker with a pause so long that it
   cannot flush by itself: `TELEMETRY_FLUSH_INTERVAL_MS=60000 npm run dev:worker`. Send three
   events (they wait in the buffer), then press Ctrl+C in the worker terminal. The log reads
   `shutdown started`, `telemetry batch flushed` (`claimed: 3`), `telemetry buffer drained`,
   `shutdown complete`: it emptied the buffer before exiting instead of waiting a minute.
7. **Ask questions with SQL.** Open [`docs/sql/telemetry.sql`](sql/telemetry.sql): latest
   events, top pages, unique visitors per day, organisations, tagged-link sessions, referrers,
   devices, clicks, and how long events waited in Redis.

### 7.2 Phase 4: the contact form, rate limiter and notifications

**Part A: the API side.** The path of one message into the system (DESIGN.md §8.3):

```
curl / form ─► rate limiter ─► contact_messages (Postgres, PENDING) ─► jobs:notifications:ready
               ratelimit:contact:<hash>                                  (Redis LIST, ids only)
               (Redis ZSET, one member per accepted request)
```

**Before you start** (once): the API now needs `IP_HASH_SECRET`. Copy the "Contact form" block
from `.env.example` into your `.env`, run `npm run db:migrate` (it applies
`0005_contact_messages`), and restart `npm run dev:api`. Arrange three terminals: the API,
`MONITOR` (§4), and one for `curl`. Open the Redis view and the `contact_messages` table.

1. **Send a message and read the headers.**

   ```bash
   curl -si -X POST localhost:4000/api/v1/contact -H 'content-type: application/json' \
     -d '{"name":"Ada","email":"ada@example.com","message":"Hello!"}'
   ```

   `-i` prints the response headers: `HTTP/1.1 202 Accepted`, `x-ratelimit-limit: 3`,
   `x-ratelimit-remaining: 2`. `MONITOR` shows the order of work: first an `evalsha` (the
   sliding-window script) with the `[0 lua]` lines it ran (`ZREMRANGEBYSCORE`, `ZCARD`, `ZADD`,
   `PEXPIRE`), then the `INSERT` happens in Postgres (not visible in `MONITOR`), then an `lpush`
   to `jobs:notifications:ready`.

2. **Look at the three places it left a trace.**
   - Redis view, filter `ratelimit:*`: one key, `ratelimit:contact:` followed by 64 hex
     characters (the HMAC of `127.0.0.1`, never the IP itself). Its type is **ZSET**: one
     member per accepted request, and each member's **score** is the request time in
     milliseconds since 1970. Its TTL counts down from 600 s.
   - Redis view, `jobs:notifications:ready`: a LIST with one job,
     `{"jobId":…,"messageId":…,"attempt":1,"enqueuedAt":…}`. Ids only: the name, email and
     text stay in Postgres.
   - `contact_messages`: the row, `status = PENDING`, `attempts = 0`. Its `id` is the job's
     `messageId`. It stays `PENDING` until the worker sends the notification (Part B).
3. **Hit the limit.** Run the `curl` three more times. The fourth answers
   `429 Too Many Requests` with `retry-after: 5xx` (seconds until your first message leaves
   the 10-minute window) and `x-ratelimit-remaining: 0`. Refresh the ZSET: still **3**
   members. Rejected requests are not recorded, so hammering the endpoint while blocked never
   extends the lockout. `MONITOR` shows the script ran `ZRANGE … WITHSCORES` (to find the
   oldest member) instead of `ZADD`.
4. **Watch the window slide.** Waiting 10 minutes is dull, so restart the API with a short
   window: `CONTACT_RATE_LIMIT_WINDOW_SECONDS=30 npm run dev:api`. Delete the ZSET key in the
   Redis view (that resets your window), send 3 messages a few seconds apart, then a fourth:
   its `retry-after` is the time until the **first** one is 30 s old. Send again after that:
   one slot is free, not three. That is the difference from a fixed window, which would reset
   everything at once.
5. **Invalid input still counts.** Send `{"name":"Ada","email":"nope","message":"Hi"}`: `400`
   with `details`, but `x-ratelimit-remaining` went down. The limiter runs before validation,
   so a bot cannot try thousands of payloads for free.
6. **Redis goes down: fail closed.** `docker compose stop redis`, send a message:
   `503 SERVICE_UNAVAILABLE`, and no new row in `contact_messages`. Without Redis the API
   cannot count, and refusing beats letting a bot flood your inbox. `docker compose start redis`.
7. **Read the messages with SQL.** Open [`docs/sql/contact.sql`](sql/contact.sql): latest
   messages, counts per status, stuck `PENDING` messages, failed notifications, repeat senders.

**Part B: the worker side.** The path of one job out of the system:

```
jobs:notifications:ready ─► worker takes it (BLMOVE) ─► jobs:notifications:processing ─► notifier
                                                              │
         sent ─────────────► contact_messages.status = SENT ◄─┤
         failed, retryable ► jobs:notifications:delayed ──────┤ (ZSET, score = when to retry;
                             └─► promoter, every 1 s ─► ready │  the job comes back here)
         failed for good ──► jobs:notifications:dlq + status = FAILED
```

Keep a fourth terminal for `npm run dev:worker`. You will send several messages: when the
rate limiter answers `429`, delete the `ratelimit:contact:…` key in the Redis view.

8. **Start the worker and watch the backlog drain.** The messages from Part A are still in
   `jobs:notifications:ready`. Start `npm run dev:worker`: the log says `worker started`
   (`notifier: "log"`), then for each message `new contact message (log notifier …)` and
   `notification sent`. Refresh: the ready list is gone, and the rows are `SENT` with
   `attempts = 1` and `sent_at` filled in. `MONITOR` shows, per job: `lmove` (the check for
   stranded jobs, answering nil), `blmove` (take), `lrem` from `processing` (done).
9. **Waiting without polling.** Leave the worker idle and watch `MONITOR`: a `blmove … 5`
   every 5 s (a wait that timed out, then the next one starts) and the promoter's `evalsha`
   every second. Now send a message: the worker reacts at once. `BLMOVE` returns the moment
   the API's `lpush` lands, instead of the worker asking "anything new?" on a timer.
10. **Send it to your real Discord.** In Discord: Server Settings → Integrations → Webhooks →
    New Webhook → pick a channel → Copy Webhook URL. In `.env`, set `NOTIFIER_DRIVER=discord`
    and `DISCORD_WEBHOOK_URL=<the URL>`, and restart the worker. Send a message: it arrives as
    a card with the name, email and text. Try `"message":"@everyone hi"`: the text shows, but
    nobody is pinged (`allowed_mentions` in `infra/notifiers/discord.notifier.ts`).
11. **A webhook that is down: retries, then the DLQ.** Restart the worker pointing at an
    address where nothing listens (an env var beats `.env`):

    ```bash
    NOTIFIER_DRIVER=discord DISCORD_WEBHOOK_URL=https://127.0.0.1:59999/webhook npm run dev:worker
    ```

    Send a message. The log says `notification failed, will retry` with `retryInMs` around
    5000 (a refused connection is worth retrying). In the Redis view the job now sits in
    `jobs:notifications:delayed`, a ZSET whose score is the time it may run again, in ms.
    About 5 s later `MONITOR` shows the promoter's script move it (`[0 lua]` `ZREM`, `LPUSH`),
    attempt 2 fails and waits ~10 s, attempt 3 fails, and the log says
    `notification failed for good, dead-lettered` with `reason: attempts_exhausted`. The row
    is `FAILED`, `attempts = 3`, `last_error = Discord webhook request failed: ECONNREFUSED`,
    and `jobs:notifications:dlq` holds the job, the reason and the error.

12. **Fix it, then replay.** Restart the worker normally (`npm run dev:worker`), then run
    `npm run dlq:replay -- notifications`. The row goes back to `PENDING` with `attempts = 0`,
    a fresh job is queued, and the worker sends it: `SENT`.
13. **A refusal is not retried.** Restart the worker with a webhook URL Discord does not know:
    `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/0/not-a-token`. Send a message:
    Discord answers with a 4xx error, and after **one** attempt the job is dead-lettered with
    `reason: rejected`. Asking again with the same bad URL would fail the same way, so the
    worker does not waste attempts on it.
14. **A crash mid-job.** Stop the worker and send a message. In the Redis CLI panel, play a
    worker that took the job and died:
    `LMOVE jobs:notifications:ready jobs:notifications:processing RIGHT LEFT`. Start the
    worker: `requeued jobs left in processing by an earlier run`, then `notification sent`.
15. **A lost job: the reconciler.** Stop the worker, send a message, then delete
    `jobs:notifications:ready` in the Redis view, as if the API's `lpush` had failed. The row
    is `PENDING` with no job anywhere. Start the worker: nothing happens yet. The reconciler
    runs every 60 s and only picks messages untouched for 5 minutes. To skip the wait, make
    the row look old in the SQL editor:
    `UPDATE contact_messages SET updated_at = now() - interval '10 minutes' WHERE status = 'PENDING';`
    Within a minute: `pending message had no job, re-queued`, then `notification sent`.
16. **Graceful shutdown.** Press Ctrl+C in the worker terminal: `shutdown started`, then
    `notification consumer stopped` straight away. The consumer does not sit out its 5 s
    `BLMOVE`; closing its connection ends the wait. Then the telemetry drain, and
    `shutdown complete`.

### 7.3 Phase 5: metrics and the status endpoint

Two ways to ask the API how it is doing (DESIGN.md §7.7):

- `GET /metrics`: the Prometheus text format, for a monitoring server that collects it every
  few seconds. Counters add up from the moment the process started.
- `GET /api/v1/admin/system-status`: JSON, for people, owner-only since Phase 6 (it needs the
  `ADMIN_TOKEN` bearer token). The `/admin` page shows it.

With `npm run dev:api` running:

1. **Read the Prometheus format.** Make a few requests, then look at one metric:

   ```bash
   curl -s localhost:4000/api/v1/projects > /dev/null
   curl -s localhost:4000/metrics | grep -A4 'TYPE http_requests_total'
   ```

   ```
   # TYPE http_requests_total counter
   http_requests_total{method="GET",route="/api/v1/projects",status_code="200"} 1
   ```

   Each line is a name, labels in `{}`, and a value. A **counter** only ever goes up (a restart
   starts it from 0 again); Prometheus works out rates like "requests per second" by comparing
   two readings. Request the projects again and re-run the `grep`: 1 becomes 2.

2. **A histogram is a row of counters.**
   `curl -s localhost:4000/metrics | grep 'duration_seconds_bucket.*route="/api/v1/projects"'`
   prints one line per bucket: `le="0.005"` counts requests that took at most 5 ms, `le="0.01"`
   at most 10 ms, up to `le="+Inf"` (all of them). Each bucket includes the smaller ones, which
   is how Prometheus estimates a p95 later (`histogram_quantile`). The first request, a cache
   miss that went to Postgres, may land in a slower bucket than the cache hits after it.

3. **Templates, not URLs.** `curl -s localhost:4000/api/v1/projects/nope` and
   `curl -s localhost:4000/wp-login.php`, then `grep http_requests_total` again: you get
   `route="/api/v1/projects/:slug"` and `route="unmatched"`, never `nope` or `wp-login.php`.
   Every distinct label value is a separate series that Prometheus stores forever, so a bot
   trying a million URLs must not create a million series.

4. **A gauge is a current value.** `curl -s localhost:4000/metrics | grep queue_depth` lists
   five queues. Stop the worker, send an event (§7.1 step 2) and re-run:
   `queue_depth{queue="telemetry_buffer"} 1`. Start the worker: back to 0. `MONITOR` shows what
   each scrape costs: four `llen` and one `zcard`, sent together. Now
   `docker compose stop redis` and scrape again: the `queue_depth` lines are **gone** (unknown,
   not zero) and `observability_read_errors_total{source="queue_depths"}` went up.
   `docker compose start redis`.

5. **The status endpoint.**

   ```bash
   export ADMIN_TOKEN=local-dev-only-admin-token-change-me-in-production   # from your .env
   curl -s -H "Authorization: Bearer $ADMIN_TOKEN" localhost:4000/api/v1/admin/system-status | python3 -m json.tool
   ```

   Uptime, Postgres and Redis latency, p50/p95 of the last 5 minutes, cache hits and misses,
   page views in the last 24 h, and every queue's length. Run it twice within 5 s:
   `generatedAt` is the same (served from the 5 s cache). Your status calls do not raise
   `http.requestCount`: the monitors' own requests are left out, or watching would change what
   is watched. Stop Postgres: still `200`, `postgres` is `down` and `pageViewsLast24h` is
   `null`.

6. **Protect `/metrics`.** Restart with a token:
   `METRICS_TOKEN=local-test-token-1234 npm run dev:api`.
   `curl -si localhost:4000/metrics | head -5` answers `401` with `www-authenticate: Bearer`;
   `curl -s -H 'authorization: Bearer local-test-token-1234' localhost:4000/metrics | head -3`
   works. The status endpoint has its own token, `ADMIN_TOKEN` (step 5).

7. **Security headers and CORS.** `curl -si localhost:4000/api/v1/projects | head -20` shows
   Helmet's headers (`x-content-type-options: nosniff`, `strict-transport-security`, …). Then
   ask the question a browser asks before the web app may POST JSON (a "preflight"):

   ```bash
   curl -si -X OPTIONS localhost:4000/api/v1/contact -H 'origin: http://localhost:3000' \
     -H 'access-control-request-method: POST' -H 'access-control-request-headers: content-type'
   ```

   `204` with `access-control-allow-origin: http://localhost:3000` and
   `access-control-max-age: 600` (the browser may skip asking again for 10 minutes). With
   `-H 'origin: https://evil.example'` the allow-origin header is missing, so a browser would
   hide the answer from that site's script. curl itself ignores all this: CORS protects
   browser users, it is not a password.

### 7.4 Phase 5b: the website feeds the pipelines

Until now you played the browser with `curl`. Now a real browser sends the same requests.
Run `npm run dev:api`, `npm run dev:worker`, `npm run dev:web` and `MONITOR`, and open
http://localhost:3000 in Chrome or Firefox with the developer tools open (F12).

1. **Your own page view.** On load, the Network tab shows a `POST` to `localhost:4000/api/v1/events`
   (`202`). Just one request: the beacon sends its JSON as `text/plain`, which browsers treat as a
   "simple" request that needs no CORS preflight. (The contact form in step 4 sends
   `application/json`, and there you will see the `OPTIONS` preflight first: the browser asking
   whether localhost:3000 may POST JSON.) `MONITOR` shows the bounded-enqueue `evalsha`; within 5 s
   the worker flushes it. In `analytics_events` the newest row now has a real `browser`, `os` and
   `device_type` (not curl's empty values) and your `timezone`. The Request payload in the Network
   tab shows exactly what was sent, including the `sessionId` from session storage (Application tab
   → Session storage → `portfolio.sessionId`).
2. **A tagged link.** Open http://localhost:3000/?ref=acme&utm_source=linkedin: the row has
   `ref = acme` and `utm_source = linkedin`. Click to a project page and back: more page views
   with the same `session_id`, and `referrer_host` empty after the first one (only the first
   view says where you came from).
3. **A click.** Click the LinkedIn button in the hero: an `interaction` row with
   `event_name = click:linkedin-link`. It is sent with `keepalive`, so it arrives even though
   the click opened another tab.
4. **The contact form.** Send a message from the "Get in touch" section: `202`, a new
   `contact_messages` row, the worker's `notification sent` (or your Discord channel). Send
   four: the fourth shows "To keep spam out, the form accepts 3 messages per person every 10
   minutes. Please try again in 10 minutes", built from the `X-RateLimit-*` and `Retry-After`
   headers (readable only because the API exposes them, §7.3 step 7).
   Delete the `ratelimit:contact:…` key to reset. Try an invalid email: the error appears
   instantly, before any request (the form uses the API's own schema from `packages/shared`).
5. **The API goes away.** Stop `dev:api` and reload: the "This page couldn't load" page with
   a **Try again** button (`app/error.tsx`). Start the API again and press it.
6. **Every device.** In the developer tools, toggle the device toolbar (Ctrl+Shift+M) and try
   a phone, a tablet and a desktop width: one column and a `menu` button on phones, two to
   three project columns on wider screens, nothing scrolling sideways. Under Rendering, set
   "Emulate CSS prefers-reduced-motion" to `reduce` and reload: no animation, all content
   visible.

### 7.5 The live dashboard (Phase 5c; owner-only since Phase 6)

Open http://localhost:3000/admin (API, worker and web running) next to the terminal. The
browser asks for a login: any username, and `ADMIN_TOKEN` from your `.env` as the password.
The system dashboard is at the bottom of the page, under the visitor summary.

1. **It polls.** The Network tab shows `GET /admin/system-status` every 5 s: a route on the
   web server, which asks the API with the token (the browser never sees it). "updated N s
   ago" counts up between polls. The charts cover the last 30 minutes, with a time label
   every 5 minutes; the line starts after the second sample; hover (or touch) a chart for the
   exact value at that moment.
2. **Make traffic.** Reload the home page a few times in another tab: "requests · 5 min" and
   the requests chart rise, the cache hit ratio climbs (the first load was a miss), and
   "page views · 24 h" goes up once the worker has flushed your page views.
3. **It saves work when nobody looks.** Switch to another tab for a minute: the polls stop.
   Come back: one poll at once, then every 5 s again.
4. **An outage.** `docker compose stop redis`: within 5 s the banner turns amber
   ("! Degraded: redis is down"), Redis shows "✕ down", and the queues read "unknown". The
   page itself keeps working: that is when you need it most. Start Redis again.
   Then stop `dev:api`: the banner turns red ("Lost contact… from N s ago") and the last
   numbers stay on screen. Start it again and the page recovers by itself.
5. **A dead letter.** `RPUSH telemetry:events:dlq '{"x":1}'` in the Redis CLI panel: the
   telemetry dead-letter row says "needs attention". Delete the key afterwards.

### 7.6 Phase 6b: the production stack on your laptop

The production stack ([PRODUCTION-STACK.md](PRODUCTION-STACK.md)) has its **own** Postgres and
Redis (project `portfolio-prod`, separate volumes). They publish no ports, on purpose, so the
VS Code connections above keep showing your **dev** data. Look inside the stack's datastores
through Docker instead (from the repository root):

```bash
C="docker compose -f deploy/compose.prod.yml"
$C exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'   # then: \dt, SELECT …
$C exec redis redis-cli MONITOR                                      # every command, live
$C exec redis redis-cli LLEN telemetry:events:buffer
```

What to watch:

1. **Two replicas, one Redis.** Run `MONITOR`, then load https://localhost twice. The content
   reads (`GET cache:v3:profile`…) arrive from two different client addresses: api-1 and
   api-2 share one cache, so a hit on one is a hit on both (DESIGN.md §14.5).
2. **The round robin.** On https://localhost/admin, the line at the bottom of the system status
   names `api-1, api-2`: polls reach the two in turn, and the page adds up their requests and
   cache counts (DESIGN.md §8.6).
3. **A replica stops.** `$C stop api-1`, keep reloading the site: nothing fails, and 30 s later
   the bottom line names only `api-2`. `$C up -d --wait api-1` brings it back.
4. **Caddy's view.** `$C exec caddy wget -qO- http://127.0.0.1:2019/reverse_proxy/upstreams`
   lists each replica with the requests it is handling right now.

### 7.7 Phase 6c: a deploy, seen from the datastores

Same commands as §7.6; on the server, `C="docker compose -f ~/portfolio/deploy/compose.prod.yml"`.
Try it on the laptop with `docker tag portfolio-api:dev portfolio-api:v2` (and the same for
`portfolio-web`), then `npm run stack:deploy -- v2` ([CD.md](CD.md)).

1. **Which release runs.** `$C ps --format '{{.Service}} {{.Image}}'`: every API container
   (api-1, api-2, worker) shows the same tag, and `grep _IMAGE deploy/.env` names it too.
   During a deploy, watch the tags change one service at a time.
2. **Migrations only go forward.** In psql:
   `SELECT version, name, applied_at FROM schema_migrations ORDER BY version;` The first deploy
   on the server adds all 7 rows; a release with a new migration adds one row; a rollback
   removes none (CD.md §4).
3. **The content step clears the cache, then warms it.** Run `$C exec redis redis-cli MONITOR`,
   then deploy: at "publishing the content" the `cache:*` keys are deleted and written again
   (the seed's log line counts them: `cacheKeysCleared`). Afterwards
   `$C exec redis redis-cli --scan --pattern 'cache:*'` lists them again.
4. **No API request is lost.** Keep https://localhost/admin open during a deploy: "answered
   by" shows `api-2` while api-1 is replaced, then `api-1` while api-2 is. Only the `web` step
   interrupts it, for under a second, and the dashboard keeps its last numbers meanwhile.
   The worker's queue (`LLEN telemetry:events:buffer`) may grow while the worker is
   replaced, then drains.

## 8. Troubleshooting

| Symptom                             | Fix                                                                   |
| ----------------------------------- | --------------------------------------------------------------------- |
| "Connection refused"                | `npm run infra:up`; use `127.0.0.1` instead of `localhost`            |
| Connects, but no tables             | `npm run db:migrate` (and `npm run content:seed` for content rows)    |
| Redis view shows no `cache:` keys   | Make sure the connection uses DB **0**, make a request, press refresh |
| `portfolio_test` database missing   | It is created by the first `npm run test:integration`                 |
| `analytics_events` stays empty      | Is `npm run dev:worker` running? Events wait in Redis until it is     |
| Contact messages stay `PENDING`     | Is the worker running? Its log says why a notification failed         |
| Worker exits: `DISCORD_WEBHOOK_URL` | Set it, or `NOTIFIER_DRIVER=log` for the log notifier                 |
| API exits: `GEOIP_…: cannot open`   | `npm run geoip:download`, or remove the `GEOIP_*` lines from `.env`   |
| `organization`/`city` always empty  | Normal locally (`127.0.0.1`); see §7.1 step 3 to try a public IP      |
