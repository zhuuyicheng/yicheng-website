# Guided Tour: Phases 1–4, Hands-On

A set of short "stations" that let you poke at everything built so far. Each station is
10–15 minutes and has the same shape:

- **Do**: commands to run
- **See**: what should happen
- **Why**: the idea behind it
- **Code**: where it lives, so you can read it right after seeing it

Do them in order, one or two per sitting. Nothing here can damage anything: every experiment
says how to undo itself, and `npm run content:seed` always restores your content.

---

## Station 0: Set up your workbench (10 min)

You'll want **three terminals** (VS Code: `Ctrl+Shift+5` splits the terminal) and the
**PostgreSQL** and **Redis** sidebars from [DATA-TOOLS.md §1](DATA-TOOLS.md#1-one-time-setup).

```bash
# Terminal A: datastores + API
nvm use
npm run infra:up          # Postgres + Redis in Docker (waits until healthy)
npm run db:migrate        # creates/updates tables (safe to re-run)
npm run content:seed      # loads apps/api/content/portfolio.json
npm run dev:api           # leave running; this is where logs appear

# Terminal B: your "client"
curl -s localhost:4000/health

# Terminal C: a live feed of every Redis command
docker compose exec redis redis-cli MONITOR
```

**See**: Terminal A prints `api started` with the address; Terminal B prints
`{"status":"ok",...}`.

---

## Station 1: One request, end to end (Phase 1)

**Do**

```bash
curl -i localhost:4000/health -H 'x-request-id: tour-1'
curl -i localhost:4000/does-not-exist
```

**See**

- Both responses carry an `x-request-id` header. The first echoes `tour-1`; the second got a
  generated UUID.
- In Terminal A, every log line for that request is tagged `requestId: "tour-1"`.
- The 404 uses the same error shape every endpoint uses:
  `{"error":{"code":"NOT_FOUND","message":"…","requestId":"…"}}`.

**Why**: in production thousands of requests interleave in the logs. A request id lets you pull
out every line belonging to _one_ request, and a client can quote it when reporting a problem.

**Code**: [middleware/request-id.ts](../apps/api/src/middleware/request-id.ts) →
[controllers/health.controller.ts](../apps/api/src/controllers/health.controller.ts) →
[services/health.manager.ts](../apps/api/src/services/health.manager.ts);
errors: [middleware/error-handler.ts](../apps/api/src/middleware/error-handler.ts).

---

## Station 2: The content API (Phase 2)

**Do**: open these in your browser (Firefox and Chrome pretty-print JSON):

- http://localhost:4000/api/v1/profile
- http://localhost:4000/api/v1/projects
- http://localhost:4000/api/v1/projects/bowling-buddy
- http://localhost:4000/api/v1/projects/Bowling_Buddy (invalid slug)
- http://localhost:4000/api/v1/projects/does-not-exist

**See**: your profile, experience, education and projects wrapped in `{ "data": … }`; a
`400 VALIDATION_ERROR` naming the `slug` field; a `404 NOT_FOUND`.

**Why**: `400` means "your request is malformed" and `404` means "well-formed, but no such
thing". Clients handle these differently, so the API keeps them distinct.

**Code**: [controllers/content.controller.ts](../apps/api/src/controllers/content.controller.ts) →
[services/content.manager.ts](../apps/api/src/services/content.manager.ts) →
[dal/content.dal.ts](../apps/api/src/dal/content.dal.ts) →
[views/content.view.ts](../apps/api/src/views/content.view.ts). Row types:
[dao/content.dao.ts](../apps/api/src/dao/content.dao.ts); response types:
[schema/content.schema.ts](../apps/api/src/schema/content.schema.ts).

---

## Station 3: Watch the cache work

Follow the walkthrough in [DATA-TOOLS.md §5](DATA-TOOLS.md#5-walkthrough-watch-a-cache-miss-become-a-hit-phase-2):
delete a key in the Redis sidebar, request it twice, and watch Terminal C.

**See**: first request → `get` then `set … EX ~300` and `x-cache: miss`; second request → only
`get` and `x-cache: hit`. In the Redis sidebar the key's TTL counts down; at 0 it vanishes and
the next request is a miss again.

**Why**: Postgres is the source of truth; Redis keeps a ready-made copy so most requests never
touch the database. The ±10 % TTL jitter means keys don't all expire in the same second.

**Code**: [services/cache-aside.manager.ts](../apps/api/src/services/cache-aside.manager.ts) (the whole
algorithm is ~100 lines; read `read()` first).

---

## Station 4: Pull the plug (resilience)

**Do**, one outage at a time, in Terminal B:

```bash
# 4a. Redis down
docker compose stop redis
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/health          # 503
curl -si localhost:4000/api/v1/projects | head -1                        # 200 OK!
docker compose start redis

# 4b. Postgres down
curl -s localhost:4000/api/v1/projects > /dev/null                       # make sure it's cached
docker compose stop postgres
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/health          # 503
curl -si localhost:4000/api/v1/projects | grep -i x-cache                # hit: still served!
docker compose exec redis redis-cli DEL cache:v1:project:bowling-buddy
curl -s localhost:4000/api/v1/projects/bowling-buddy                     # see below
docker compose start postgres
```

**See**

- **Redis down**: `/health` reports `degraded`, but content is still served from Postgres.
  Terminal A logs `redis reconnecting` and `cache operation failed, serving from postgres`.
  When Redis returns, everything recovers without restarting the API.
- **Postgres down**: cached content keeps working. That's a bonus of caching. An uncached
  request fails with `503 SERVICE_UNAVAILABLE`: "a dependency is down, try again soon".

**A gap this station found**: before Phase 3, that last request returned `500 INTERNAL_ERROR`,
which means "the server has a bug". Phase 3 fixed it with a classifier that tells an outage
(retry later) from a bug: [infra/transient-error.ts](../apps/api/src/infra/transient-error.ts),
used by [middleware/error-handler.ts](../apps/api/src/middleware/error-handler.ts). The
regression test is "answers 503 (not 500) for a cache miss" in `test/integration/content.test.ts`.

**Why**: `/health` answers "is everything healthy?", which is strict. The content API answers
"can I still serve this request?", which is tolerant. Redis is an _optimisation_ for content,
so losing it degrades speed, not correctness.

---

## Station 5: Edit your content (and break it on purpose)

**Do**

1. Change your headline in [portfolio.json](../apps/api/content/portfolio.json), then run
   `npm run content:seed`. Reload `/api/v1/profile`.
2. Now introduce two mistakes: change a slug to `Bowling Buddy` and set an experience's
   `endDate` before its `startDate`. Run `npm run content:seed` again.
3. Undo the mistakes and seed once more.

**See**

1. The new headline appears immediately (the seed clears and re-warms the cache. Terminal C
   shows the `del` and the `get`/`set` pairs).
2. The seed refuses, listing **every** problem with its location, and writes nothing:

   ```
   FATAL: …/portfolio.json is invalid
       problems: [
         "experiences.0.endDate: must not be before startDate",
         "projects.1.slug: must be lowercase letters/digits separated by hyphens"
       ]
   ```

**Why**: validate everything first, then write everything in one transaction. You can never
end up with half-published content.

**Code**: [cli/seed-content.ts](../apps/api/src/cli/seed-content.ts),
[schema/content.schema.ts](../apps/api/src/schema/content.schema.ts) (section 2).

---

## Station 6: Explore the database

**Do**: in the PostgreSQL sidebar, open `portfolio` → `public` → Tables, then open
[docs/sql/content.sql](sql/content.sql) and run each query.

**See**: `schema_migrations` lists `0001` and `0002` with checksums; the `pg_stat_activity`
query shows a connection named `portfolio-api` (your running API).

**Experiment: why you must never edit an applied migration**

```bash
echo "-- harmless comment" >> apps/api/migrations/0001_portfolio_content.sql
npm run db:migrate
# → FATAL … "Migration 0001_portfolio_content.sql was modified after being applied;
#            add a new migration instead"
git checkout apps/api/migrations/0001_portfolio_content.sql     # undo
```

**Why**: the migrator stores a fingerprint (SHA-256) of each file it ran. Even a comment
changes the fingerprint. The point is that every database built from the same files must end
up identical. Changes always go in a _new_ migration, which is exactly how education was
added (`0002`).

**Code**: [db/migrator.ts](../apps/api/src/db/migrator.ts), [migrations/](../apps/api/migrations/).

---

## Station 7: Fail fast on bad config

**Do**: stop the API (Ctrl+C in Terminal A, watch the ordered shutdown), then:

```bash
API_PORT=abc CACHE_TTL_SECONDS=0 npm run dev:api
```

**See**

```
Invalid environment configuration:
  - API_PORT: Invalid input: expected number, received NaN
  - CACHE_TTL_SECONDS: Too small: expected number to be >=1
```

It lists **all** problems at once, opens no connections, and exits. (Variables set on the
command line override `.env`.) Press Ctrl+C, then `npm run dev:api` to start normally.

**Why**: a typo in config should stop the app at startup with a clear message, not cause a
mysterious failure an hour later.

**Code**: [config/env.ts](../apps/api/src/config/env.ts),
[lifecycle/graceful-shutdown.ts](../apps/api/src/lifecycle/graceful-shutdown.ts).

---

## Station 8: Let the tests catch you

**Do**

```bash
npm run test:watch -w @portfolio/api      # unit tests re-run on every save
```

Now, in [services/cache-aside.manager.ts](../apps/api/src/services/cache-aside.manager.ts), change
`TTL_JITTER_RATIO = 0.1` to `0.5` and save. Then undo it and save again.

**See**: the `ttlWithJitter` tests turn red within a second, telling you exactly which
expectation broke; undoing turns them green.

Then run the whole suite once: `npm test` (175 tests). Pick one test file, read it, and match
each `it(...)` to a behaviour you saw in Stations 1–7.

**Why**: tests are the safety net that lets later phases change code without fear. CI runs
the same tests on GitHub for every pull request ([CI.md](CI.md)).

---

## Station 9: Follow an event into Postgres (Phase 3)

**Do**: start the worker in a fourth terminal, then send an event.

```bash
# Terminal D: the worker, which moves events from Redis to Postgres
npm run dev:worker

# Terminal B
curl -s -X POST localhost:4000/api/v1/events -H 'content-type: application/json' \
  -d '{"type":"page_view","path":"/?ref=tour","sessionId":"tourSession01","timezone":"Asia/Singapore"}'
```

**See**

- Terminal B: `{"data":{"eventId":"…"}}` with status `202 Accepted`: queued, not yet stored.
- Terminal C (`MONITOR`): the API's `evalsha` appends the event to `telemetry:events:buffer`.
  Within 5 s the worker's `evalsha` moves it to `telemetry:events:inflight`, and a `del`
  removes that list once Postgres has the row.
- Terminal D: `telemetry batch flushed` with `inserted: 1`.
- PostgreSQL sidebar: a new row in `analytics_events` with `ref = tour` and your time zone.

**Why**: the visitor's request only waits for Redis (well under a millisecond), never for
Postgres. The worker inserts whole batches with one statement, and keeps a copy of each batch in
Redis until Postgres has it, so neither a crash nor an outage loses an event.

**Code**: the request: [events.controller.ts](../apps/api/src/controllers/events.controller.ts) →
[telemetry.manager.ts](../apps/api/src/services/telemetry.manager.ts) (with
[visitor-details.manager.ts](../apps/api/src/services/visitor-details.manager.ts)) →
[event-buffer.dal.ts](../apps/api/src/dal/event-buffer.dal.ts). The worker:
[worker.ts](../apps/api/src/worker.ts) →
[telemetry-flusher.worker.ts](../apps/api/src/workers/telemetry-flusher.worker.ts) →
[telemetry-flush.manager.ts](../apps/api/src/services/telemetry-flush.manager.ts) →
[analytics-event.dal.ts](../apps/api/src/dal/analytics-event.dal.ts).

**More experiments** (an outage, a poison event and the DLQ, graceful shutdown, an IP's
organisation): [DATA-TOOLS.md §7.1](DATA-TOOLS.md#71-phase-3-the-telemetry-pipeline).

---

## Station 10: Send yourself a message (Phase 4)

**Do**: if your `.env` predates Phase 4, copy the "Contact form" block from `.env.example`
into it first, run `npm run db:migrate`, and restart the API and the worker. Then send the
contact form four times:

```bash
# Terminal B (run it 4 times)
curl -si -X POST localhost:4000/api/v1/contact -H 'content-type: application/json' \
  -d '{"name":"Tour","email":"tour@example.com","message":"Hello from the guided tour"}'
```

**See**

- Terminal B: three `202 Accepted` with `x-ratelimit-remaining` counting 2, 1, 0, then a
  `429 Too Many Requests` with `retry-after` (seconds until a slot frees up).
- Terminal C (`MONITOR`): per request, the API's `evalsha` (the sliding-window script) and an
  `lpush` to `jobs:notifications:ready`; then the worker's `blmove`, which was already waiting
  and takes the job at once, and an `lrem` when it is done.
- Terminal D (worker): `new contact message (log notifier …)` and `notification sent`, three
  times.
- PostgreSQL sidebar: three rows in `contact_messages`, `status = SENT`, `attempts = 1`.

**Why**: the rate limiter counts accepted requests in a Redis sorted set, with one atomic Lua
script, so even simultaneous requests cannot slip past the limit. The API stores the message
first (Postgres is the source of truth), then queues a small job with ids only; the worker
sends the notification separately, so a slow or broken Discord never makes the visitor wait.

**Code**: the request: [contact.controller.ts](../apps/api/src/controllers/contact.controller.ts)
→ [rate-limit.ts](../apps/api/src/middleware/rate-limit.ts) (hook) →
[rate-limiter.manager.ts](../apps/api/src/services/rate-limiter.manager.ts) →
[sliding-window.lua.ts](../apps/api/src/dal/lua/sliding-window.lua.ts); then
[contact.manager.ts](../apps/api/src/services/contact.manager.ts). The worker:
[notification-consumer.worker.ts](../apps/api/src/workers/notification-consumer.worker.ts) →
[notification.manager.ts](../apps/api/src/services/notification.manager.ts) →
[notification-queue.dal.ts](../apps/api/src/dal/notification-queue.dal.ts) and
[discord.notifier.ts](../apps/api/src/infra/notifiers/discord.notifier.ts).

**More experiments** (the sliding window, Redis down, a real Discord channel, retries and the
DLQ, crash recovery, the reconciler): [DATA-TOOLS.md §7.2](DATA-TOOLS.md#72-phase-4-the-contact-form-rate-limiter-and-notifications).

---

## Station 11: Check yourself

You've got Phases 1–4 down if you can answer these. Click to reveal.

<details><summary>1. Which file decides whether <code>/health</code> returns 200 or 503?</summary>

The controller, `health.controller.ts`. The manager only _reports_ each dependency's status;
picking an HTTP status code is the controller's job.

</details>

<details><summary>2. Why does content still work when Redis is down, while <code>/health</code> says 503?</summary>

Cache-aside treats Redis as optional: on any Redis error it logs, counts the error, and reads
Postgres. `/health` deliberately reports _every_ dependency so operators notice the outage.

</details>

<details><summary>3. Why is the profile cached under <code>cache:v2:profile</code> but projects under <code>v1</code>?</summary>

Adding `education` changed the profile's JSON shape, so its key version was bumped; old
entries are never read again and simply expire. Project shapes didn't change.

</details>

<details><summary>4. What is single-flight, and which test proves it works?</summary>

Concurrent cache misses for the same key share one database query. Proven by "shares one
source load between concurrent misses" in `test/unit/services/cache-aside.manager.test.ts`.

</details>

<details><summary>5. You want to add a "certifications" list. What do you create?</summary>

A new migration (the next free number, never an edit to an applied one), a row type in `content.dao.ts`, Zod
schemas in `content.schema.ts`, SQL + a row mapping in `content.dal.ts`, a view mapping, tests,
and a profile cache key bump to `v3`.

</details>

<details><summary>6. Why can't you see "not found" responses being cached in Redis?</summary>

`null` results are deliberately not cached, so newly published content shows up immediately
instead of being hidden by a cached "doesn't exist".

</details>

<details><summary>7. Why does <code>POST /api/v1/events</code> answer 202, not 201?</summary>

`201 Created` would claim the event is stored. It is only queued in Redis; the worker stores it
a moment later. `202 Accepted` means exactly "accepted for processing".

</details>

<details><summary>8. Postgres is down for ten minutes. What happens to the events sent meanwhile?</summary>

Ingestion still answers 202, because it never touches Postgres. The worker's flush fails with a
transient error, so the batch stays in `telemetry:events:inflight` and is retried with backoff
(0.5 s doubling to 30 s), while new events wait in the buffer (503 only once it holds
`TELEMETRY_BUFFER_MAX_LENGTH`). Nothing goes to the DLQ, which is reserved for bad data.

</details>

<details><summary>9. The worker crashes after inserting a batch but before acknowledging it. Why are there no duplicate rows?</summary>

On restart the claim script returns the in-flight batch again, but every event's id was
assigned at ingestion and the insert says `ON CONFLICT (id) DO NOTHING`, so re-inserting it is a
no-op. Proven by "after a crash between insert and acknowledge, re-delivers the batch without
duplicates" in `test/integration/telemetry-flusher.test.ts`.

</details>

<details><summary>10. Which test proves the worker empties the buffer when it is stopped?</summary>

"on SIGTERM, drains the whole buffer into Postgres, then exits with code 0" in
`test/integration/worker-process.test.ts`. It starts the real worker process with a 5-minute
flush interval, so anything flushed after `SIGTERM` was flushed by the drain.

</details>

<details><summary>11. Twenty requests arrive at the same instant. Why do exactly 3 get through, not 20?</summary>

Counting and adding happen inside one Lua script, and Redis never runs another command in the
middle of a script. As two separate commands (count, then add), all twenty could count 0
before any of them added itself. Proven by "admits exactly 3 of 20 simultaneous requests, even
across 4 API instances" in `test/integration/contact.test.ts`.

</details>

<details><summary>12. Discord answers 503 three times, and another message gets 404. What happens to each?</summary>

503 means "not now", so it is retried: about 5 s later, then about 10 s later (doubling, ± 20 %
jitter). After the third failure the message is `FAILED` and its job is in the DLQ with
`reason: attempts_exhausted`. 404 means the request itself is wrong (a deleted webhook), so it
is dead-lettered after one attempt with `reason: rejected`. See the end of `run` in
`notification.manager.ts`.

</details>

<details><summary>13. Postgres goes down while the worker is sending. Why does that not use up an attempt?</summary>

Only the notifier's own errors are caught as failed attempts. A datastore error escapes
`processNext`, so the job stays in `jobs:notifications:processing`, and the consumer backs off.
The next `processNext` first moves anything stranded in `processing` back to `ready`, and the
job runs again with the same attempt number. Proven by "Postgres down mid-job" in
`test/integration/notification-worker.test.ts`.

</details>

<details><summary>14. The API saved a message but could not queue its job. Who notices, and when?</summary>

The visitor still got `202`, and `notification_enqueue_failures_total` went up. The worker's
reconciler, every 60 s, claims `PENDING` messages untouched for 5 minutes and queues a new job
for each. So the notification arrives within about 6 minutes instead of being lost.

</details>

---

## Where to go next

- [ROADMAP.md](../ROADMAP.md): what's done and what's next.
- [DESIGN.md](../DESIGN.md): §2 (architecture), §8.1 (cache), §8.2 (telemetry pipeline) and
  §8.3 (contact + notifications) are worth reading now that you've seen them working. Skip the later phases until we get there.
