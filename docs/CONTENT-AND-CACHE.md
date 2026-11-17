# Content API & Redis Cache (Phase 2)

This guide explains how the portfolio content gets from a JSON file to an HTTP response, why
Redis sits in the middle, and how to watch it work. Design reference: DESIGN.md §7.4 and §8.1.

---

## 1. The journey of your content

```
apps/api/content/portfolio.json          you edit this file
          │  npm run content:seed
          ▼
PostgreSQL (profile, experiences, education, projects)   source of truth
          │  first request (cache miss)
          ▼
Redis  cache:v1:projects  (expires after ~5 min)   fast copy
          │  following requests (cache hit)
          ▼
GET /api/v1/projects  →  { "data": [...] }   with header  X-Cache: hit | miss
```

There is no admin page: to change your portfolio, edit the JSON and re-run the seed.

## 2. Cache-aside in plain words

Postgres is reliable but each query costs a network round trip, a query plan and disk/memory
reads. Redis keeps ready-made JSON in memory. **Cache-aside** means the _application_ (not the
database) manages the cache:

1. Ask Redis for `cache:v1:projects`.
2. **Hit**: Redis has it → check it still has the right shape → return it.
3. **Miss**: Redis doesn't → query Postgres → save the answer in Redis for ~5 minutes → return.

Three extra safeguards, each with a test:

| Safeguard              | Problem it prevents                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| **TTL jitter (±10 %)** | Keys written together would expire together and all hit Postgres in the same instant.                    |
| **Single-flight**      | 100 requests arriving just after a key expires would run 100 identical queries. Now they share one.      |
| **Fallback + metric**  | If Redis is down or holds garbage, we serve from Postgres, log a warning, and bump `cache_errors_total`. |

## 3. Where the code lives (follow one request)

`GET /api/v1/projects/note-g`:

| Step | File                                                                                   | Job                                                                                                 |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1    | [controllers/content.controller.ts](../apps/api/src/controllers/content.controller.ts) | declares `GET /api/v1/projects/:slug`; validates `slug`, calls the manager, sets `X-Cache`, renders |
| 2    | [services/content.manager.ts](../apps/api/src/services/content.manager.ts)             | "which key, which query"; turns `null` into 404                                                     |
| 3    | [services/cache-aside.manager.ts](../apps/api/src/services/cache-aside.manager.ts)     | the hit/miss/fallback/single-flight algorithm                                                       |
| 4a   | [dal/content-cache.dal.ts](../apps/api/src/dal/content-cache.dal.ts)                   | Redis `GET` / `SET … EX`                                                                            |
| 4b   | [dal/content.dal.ts](../apps/api/src/dal/content.dal.ts)                               | SQL; maps each row to the API shape                                                                 |
| 5    | [views/content.view.ts](../apps/api/src/views/content.view.ts)                         | builds `{ data: … }` with only public fields                                                        |
| —    | [dao/content.dao.ts](../apps/api/src/dao/content.dao.ts)                               | row types: what a database row looks like (`snake_case`)                                            |
| —    | [schema/content.schema.ts](../apps/api/src/schema/content.schema.ts)                   | Zod schemas for responses, cache entries and the JSON file (`camelCase`)                            |

## 4. Try it yourself

Prefer to _watch_ it in VS Code? [DATA-TOOLS.md §5](DATA-TOOLS.md#5-walkthrough-watch-a-cache-miss-become-a-hit-phase-2)
walks through the same experiments in the PostgreSQL and Redis extensions, with a live
`MONITOR` feed of every Redis command. The terminal-only version:

```bash
npm run infra:up && npm run db:migrate && npm run content:seed
npm run dev:api                    # terminal A
```

In terminal B:

```bash
# 1. Miss, then hit. (The seed warmed the cache, so delete the key first to see a miss.)
docker compose exec redis redis-cli DEL cache:v1:projects
curl -si localhost:4000/api/v1/projects | grep -i x-cache     # x-cache: miss
curl -si localhost:4000/api/v1/projects | grep -i x-cache     # x-cache: hit

# 2. Look inside Redis
docker compose exec redis redis-cli --scan --pattern 'cache:*'
docker compose exec redis redis-cli TTL cache:v1:projects    # ~270–330 seconds left
docker compose exec redis redis-cli GET cache:v1:projects    # the cached JSON

# 3. One project, a missing one, and an invalid slug
curl -s localhost:4000/api/v1/projects/portfolio-telemetry-platform
curl -s localhost:4000/api/v1/projects/does-not-exist        # 404 NOT_FOUND
curl -s localhost:4000/api/v1/projects/Bad_Slug              # 400 VALIDATION_ERROR

# 4. Corrupt the cache: the API notices, logs a warning, and repairs it
docker compose exec redis redis-cli SET cache:v1:projects 'garbage'
curl -si localhost:4000/api/v1/projects | grep -i x-cache     # miss (terminal A logs a warning)

# 5. Redis down: content is still served, from Postgres
docker compose stop redis
curl -si localhost:4000/api/v1/projects | head -1             # HTTP/1.1 200 OK
docker compose start redis
```

## 5. Editing your content

1. Edit [apps/api/content/portfolio.json](../apps/api/content/portfolio.json). Array order is
   display order; projects with `"featured": true` are listed first.
2. Run `npm run content:seed`. If the file has mistakes, every problem is listed with its
   location (e.g. `projects.0.slug: must be lowercase letters/digits separated by hyphens`)
   and nothing is written.
3. The seed clears the old cache entries and warms new ones, so the API serves your edit
   immediately.

`slug` is the project's URL name (`/projects/<slug>`): lowercase words joined by hyphens.
