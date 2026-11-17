# Guided Tour: Phases 1–2, Hands-On

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
  request fails.

**Spot the gap**: that last request returns `500 INTERNAL_ERROR`. DESIGN.md §7.2 says a
required dependency being down should be `503 SERVICE_UNAVAILABLE` (meaning "try again soon",
not "the server has a bug"). This is a real gap you just found. It's on the roadmap for
Phase 3, which builds the "temporary vs permanent error" classifier this fix needs.

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

Then run the whole suite once: `npm test` (79 tests). Pick one test file, read it, and match
each `it(...)` to a behaviour you saw in Stations 1–7.

**Why**: tests are the safety net that lets later phases change code without fear. CI runs
the same tests on GitHub for every pull request ([CI.md](CI.md)).

---

## Station 9: Check yourself

You've got Phases 1–2 down if you can answer these. Click to reveal.

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
source load between concurrent misses" in `test/unit/services/cache-aside.test.ts`.

</details>

<details><summary>5. You want to add a "certifications" list. What do you create?</summary>

A new migration (`0003_…`, never an edit to 0001/0002), a row type in `content.dao.ts`, Zod
schemas in `content.schema.ts`, SQL + a row mapping in `content.dal.ts`, a view mapping, tests,
and a profile cache key bump to `v3`.

</details>

<details><summary>6. Why can't you see "not found" responses being cached in Redis?</summary>

`null` results are deliberately not cached, so newly published content shows up immediately
instead of being hidden by a cached "doesn't exist".

</details>

---

## Where to go next

- [ROADMAP.md](../ROADMAP.md): what's done and what's next.
- [DESIGN.md](../DESIGN.md): §2 (architecture) and §8.1 (cache) are worth reading now that
  you've seen them working. Skip the later phases until we get there.
