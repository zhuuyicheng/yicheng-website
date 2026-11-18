# Roadmap & Progress

Each phase is built on its own branch, opened as a pull request, verified by CI, and merged
into `main` before the next phase starts. Design details live in [DESIGN.md](DESIGN.md).

| Phase | Branch                       | Module | Status         |
| ----- | ---------------------------- | ------ | -------------- |
| 1     | `main` (initial scaffold)    | —      | ✅ Done        |
| 2     | `feat/portfolio-cache-api`   | A      | ✅ Done        |
| 3     | `feat/telemetry-pipeline`    | B      | ✅ Done        |
| 4     | `feat/contact-rate-limiter`  | C      | ✅ Done        |
| 5     | `feat/metrics-and-dashboard` | D      | ✅ Done        |
| 6     | `feat/continuous-delivery`   | —      | 🚧 In progress |

---

## Phase 1: Project skeleton & infrastructure ✅

- [x] npm workspaces monorepo (`apps/api`, `apps/web`), Node 24 LTS (`.nvmrc`)
- [x] Strict `tsconfig.base.json`, ESLint (type-aware) + Prettier
- [x] `docker-compose.yml`: Postgres 16 + Redis 7, healthchecks, named volumes
- [x] `.env.example` + fail-fast Zod config loader
- [x] Fastify app in layered layout (since restructured: see Phase 2)
- [x] Pino structured logging + `x-request-id` correlation
- [x] Consistent error envelope `{ error: { code, message, requestId } }`
- [x] `pg` pool + `ioredis` client with fail-fast startup
- [x] SQL migration runner (advisory lock, per-file transactions, checksums) + `db:migrate`
- [x] Graceful `SIGTERM`/`SIGINT` shutdown with forced-exit deadline
- [x] `GET /health` checking live Postgres + Redis
- [x] Next.js 16 + Tailwind 4 placeholder page
- [x] Tests: 32 unit + 12 integration (incl. real-process SIGTERM test)

## Phase 2: Portfolio content API + cache (`feat/portfolio-cache-api`) ✅

- [x] **CI first**: `.github/workflows/ci.yml` (format, lint, typecheck, unit + integration
      tests against Postgres/Redis service containers) — see [docs/CI.md](docs/CI.md)
- [x] Migration `0001_portfolio_content.sql` (profile, experiences, projects)
- [x] `content/portfolio.json` + `npm run content:seed` (upsert, then invalidate + warm cache)
- [x] Schema + DAO + DAL (SQL and Redis) + manager + controller + view for:
  - [x] `GET /api/v1/profile`
  - [x] `GET /api/v1/projects`
  - [x] `GET /api/v1/projects/:slug`
- [x] Redis cache-aside with TTL jitter, single-flight, `X-Cache: hit|miss` header
- [x] Redis failure → Postgres fallback (log + metric)
- [x] `infra/metrics.ts` prom-client registry: `cache_requests_total`, `cache_errors_total`,
      plus metrics for existing Redis reconnects / Postgres pool errors
- [x] Unit tests (cache-aside, content manager, content file schema) + integration tests
      (real cache round trip, Redis-down fallback, seed CLI) — 55 unit + 22 integration total
- [x] Data-viewer guide: [docs/DATA-TOOLS.md](docs/DATA-TOOLS.md) (VS Code PostgreSQL + Redis)
- [x] PR #1 merged: CI workflow only (green on PR and on `main`)
- [x] PR #2 merged: feature work (CI green)
- [x] Real profile, experience and projects filled in from the resume
- [x] Education section: migration `0002_education.sql`, `education` in `GET /api/v1/profile`
      (profile cache key bumped to `cache:v2:profile`)
- [x] Restructured the API layers: `routes/` merged into `controllers/`, `services/*.manager.ts`,
      `repositories/` → `dal/`, `models/` → `schema/` + new `dao/` row types (DESIGN.md §2.2).
      Responses and cache entries are byte-for-byte unchanged, so no cache key bump

## Phase 3: Telemetry pipeline (`feat/telemetry-pipeline`) ✅

- [x] Migration `0003_analytics_events.sql` (+ `dao/analytics-event.dao.ts`, request/buffer schemas)
- [x] Datastore unavailable → `503 SERVICE_UNAVAILABLE`, not `500` (found in the guided tour:
      Postgres down + cache miss returns 500); `infra/transient-error.ts`, reused by the flusher
- [x] `POST /api/v1/events` → validation, daily-salted visitor hash, bounded Redis buffer, `202`
      (`TRUST_PROXY`, `TELEMETRY_BUFFER_MAX_LENGTH`; ingested/rejected metrics)
- [x] Visitor details (decided mid-phase, DESIGN.md §8.2 and §12): migration
      `0004_analytics_visitor_details.sql`; tagged links (`ref`, `utm_*`), browser / OS / device
      type, language, time zone; IP → country, city, organisation from local DB-IP Lite files
      (`npm run geoip:download`, `GEOIP_*_DB_PATH`)
- [x] `worker.ts` entrypoint + telemetry batch flusher (claim → bulk insert with `unnest` → ack)
- [x] Transient vs permanent error handling (backoff 0.5 s → 30 s); poison events isolated row
      by row → DLQ
- [x] `npm run dlq:replay -- telemetry`
- [x] Worker graceful shutdown drains the buffer
- [x] Integration tests: ingest → flush, crash recovery (no duplicates), DLQ, buffer cap, IP
      lookup on MaxMind test databases, DLQ replay CLI, **worker SIGTERM graceful shutdown**
      (129 unit + 46 integration total)
- [x] DATA-TOOLS.md §7: watching the buffer drain into `analytics_events`, plus
      `docs/sql/telemetry.sql`
- [x] PR #4 merged (CI green)

## Phase 4: Contact API + rate limiter (`feat/contact-rate-limiter`) ✅

Not in scope: linking contact-form emails to browsing sessions (on hold by decision; the form
stays optional and is never required to view the site).

Built in two steps, one commit each: **4a** the API side (limiter, endpoint, job enqueue),
**4b** the worker side (notification consumer, notifiers, reconciler).

- [x] Migration `0005_contact_messages.sql` (+ `dao/contact-message.dao.ts`, request and job schemas)
- [x] Atomic Lua sliding-window rate limiter + `X-RateLimit-*` / `Retry-After` headers
      (`onRequest` hook, keyed by `HMAC-SHA256(IP_HASH_SECRET, ip)`, fails closed with `503`)
- [x] `POST /api/v1/contact` → persist `PENDING`, enqueue notification job, `202`
      (enqueue failure still answers `202`, counted in `notification_enqueue_failures_total`)
- [x] Notification worker: reliable queue, exponential backoff, DLQ, `SENT`/`FAILED` status
      (consumer on a dedicated blocking connection, requeues stranded jobs before every take;
      delayed-retry promoter every 1 s; backoff ± 20 % jitter, capped at 4 min)
- [x] Notifiers: `log` (dev) and `discord` (5 s timeout, mentions off, 429/5xx retryable)
- [x] Reconciler for messages whose enqueue failed (every 60 s, claims with `UPDATE … RETURNING`)
- [x] `npm run dlq:replay -- notifications` (reopens `FAILED` messages with a fresh job)
- [x] Worker graceful shutdown: interrupts `BLMOVE`, finishes the current job; shutdown steps
      get the time left, so the telemetry drain uses what remains
- [x] Tests (4a): 20 concurrent requests across 4 API instances admit exactly 3; sliding expiry;
      `Retry-After`; Redis down → 503 (147 unit + 56 integration total)
- [x] Tests (4b): retry/backoff/DLQ against a stub webhook; reconciler; crash recovery;
      Postgres down mid-job; real worker process sends and stops promptly (192 unit + 67
      integration total)
- [x] DATA-TOOLS.md §7.2: watching the rate-limit sorted set and the ready queue fill up
- [x] DATA-TOOLS.md §7.2: watching the worker drain the job queues, retries and the DLQ (4b)
- [x] PR #5 merged (CI green)

## Phase 5: Metrics & dashboard (`feat/metrics-and-dashboard`) ✅

Built in three steps, one commit each: **5a** the API side (metrics, status, security
headers), **5b** the website (shared schemas, pages, contact form, beacon, privacy notice),
**5c** the live dashboard.

- [x] HTTP metrics hook (duration histogram, request counter, route templates) + `queue_depth`
      gauge refreshed from Redis on every scrape
- [x] `GET /metrics` (Prometheus, optional bearer token compared in constant time)
- [x] `GET /api/v1/system/status` (uptime, health, p50/p95 over 5 min, cache ratio, page views,
      queues; 5 s cache; unreadable parts are `null`, still `200`)
- [x] Helmet security headers + CORS allow-list (`CORS_ORIGINS`, exposes the rate-limit headers)
- [x] Tests (5a): status with live datastores and Redis down, `/metrics`, token, Helmet, CORS
      (207 unit + 75 integration total)
- [x] DATA-TOOLS.md §7.3: reading `/metrics` and the status endpoint
- [x] `packages/shared` API contract schemas (content, contact, events, system status, error
      envelope); the API re-exports them, built to `dist/` by `build:shared` / `postinstall`
- [x] Next.js portfolio pages (profile, projects, contact form) + page-view beacon (sends the
      path with its query string, so tagged links work, plus referrer, session id, time zone)
      and tracked external-link clicks
- [x] Dark, developer-style design with scroll effects (reveal, hero fade, timeline fill,
      scrollspy), an interactive rate-limiter lab with sliders, responsive from phone to
      desktop, `prefers-reduced-motion` respected (DESIGN.md §8.6)
- [x] Privacy notice page: what the analytics collect and why, with the DB-IP attribution
      (DESIGN.md §12)
- [x] Tests (5b): web unit tests for the beacon, contact form, lab and formatting (282 API +
      28 web total); `next build` passes without the API running
- [x] Live system telemetry dashboard at `/status` (counts only; visitor details stay private):
      polls every 5 s, pauses in hidden tabs, keeps stale numbers on an outage, live charts;
      linked from the header, footer and a live pill in the hero
- [x] Tests (5c): dashboard logic (fetch + contract check, health, formatting, chart paths)
      (286 API + 37 web total)
- [x] Guided tour station 11 and DATA-TOOLS.md §7.5: the website and the dashboard
- [x] CI also runs the website's production build (`next build`, no API needed)
- [x] PR #6 merged (CI green)

## Phase 6: Continuous delivery (`feat/continuous-delivery`)

Design: [DESIGN.md §14](DESIGN.md#14-deployment--continuous-delivery-phase-6).

- [x] Decide hosting + hostname ([DESIGN.md §14.5](DESIGN.md#145-hosting-oracle-cloud-free-tier-one-hostname)):
      an Oracle Cloud Always Free Arm VM (2 OCPUs, 6 GB) running Docker Compose with Caddy;
      one free hostname (DuckDNS first, then is-a.dev) with Caddy routing `/api/*` to the API
      and everything else to the website; no purchased domain
- [ ] Server ready: VM, both firewalls, Docker, DuckDNS hostname, HTTPS test page
      ([docs/HOSTING.md](docs/HOSTING.md))
- [ ] `apps/api/Dockerfile` (multi-stage, non-root; one image for api/worker/migrate/seed;
      builds `packages/shared`; downloads the GeoIP files during the build),
      `apps/web/Dockerfile` (Next.js `output: 'standalone'`; built with an empty
      `NEXT_PUBLIC_API_BASE_URL`, so browsers call the same origin, DESIGN.md §14.2),
      `.dockerignore`
- [ ] CI: build both images for `linux/arm64` on GitHub's Arm runners on every PR (a broken
      Dockerfile fails before merge)
- [ ] On merge to `main`: push images to GHCR tagged with the git SHA
- [ ] `deploy/compose.prod.yml` + `Caddyfile` (path routing, internal `:8080` listener for the
      web server); production env file kept on the host only
- [ ] `.github/workflows/deploy.yml`: migrate → seed → rolling update → smoke test → auto-rollback,
      behind a `production` GitHub Environment with a required reviewer (continuous **delivery**)
- [ ] Load balancing ([DESIGN.md §14.5](DESIGN.md#145-hosting-oracle-cloud-free-tier-one-hostname)):
  - [ ] Two API replicas (`api-1`, `api-2`) behind Caddy: round robin, active health checks
  - [ ] `GET /health/live` liveness endpoint for the load balancer (no dependency checks) + tests
  - [ ] Rolling update: worker → api-1 (wait for `/health` = 200) → api-2 → web
  - [ ] Per-replica numbers: Prometheus scrapes each replica directly (`instance` in the system
        status already exists since Phase 5; set each container's hostname to `api-1`/`api-2`)
  - [ ] Prove it: a request loop sees no failures while one replica is stopped, or during a deploy
- [ ] Nightly `pg_dump` backups off the host + a tested restore
- [ ] Switch to `<name>.is-a.dev` once the site is live (you write the request by hand: their
      terms forbid AI-written pull requests)
- [ ] `docs/CD.md`: how to release, approve, roll back, read deploy logs
- [ ] Later: remove the approval gate (continuous **deployment**) once releases are routine
