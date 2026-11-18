# Roadmap & Progress

Each phase is built on its own branch, opened as a pull request, verified by CI, and merged
into `main` before the next phase starts. Design details live in [DESIGN.md](DESIGN.md).

| Phase | Branch                       | Module | Status         |
| ----- | ---------------------------- | ------ | -------------- |
| 1     | `main` (initial scaffold)    | —      | ✅ Done        |
| 2     | `feat/portfolio-cache-api`   | A      | ✅ Done        |
| 3     | `feat/telemetry-pipeline`    | B      | 🔍 In review   |
| 4     | `feat/contact-rate-limiter`  | C      | ⬜ Not started |
| 5     | `feat/metrics-and-dashboard` | D      | ⬜ Not started |
| 6     | `feat/continuous-delivery`   | —      | ⬜ Not started |

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

## Phase 3: Telemetry pipeline (`feat/telemetry-pipeline`)

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
- [ ] PR merged (CI green)

## Phase 4: Contact API + rate limiter (`feat/contact-rate-limiter`)

Not in scope: linking contact-form emails to browsing sessions (on hold by decision; the form
stays optional and is never required to view the site).

- [ ] Migration `0005_contact_messages.sql`
- [ ] Atomic Lua sliding-window rate limiter + `X-RateLimit-*` / `Retry-After` headers
- [ ] `POST /api/v1/contact` → persist `PENDING`, enqueue notification job, `202`
- [ ] Notification worker: reliable queue, exponential backoff, DLQ, `SENT`/`FAILED` status
- [ ] Notifiers: `log` (dev) and `discord`
- [ ] Reconciler for messages whose enqueue failed
- [ ] Tests: 20 concurrent requests admit exactly 3; retry/backoff/DLQ against a stub webhook
- [ ] DATA-TOOLS.md §7: watching rate-limit sorted sets and the job queues

## Phase 5: Metrics & dashboard (`feat/metrics-and-dashboard`)

- [ ] HTTP metrics hook (duration histogram, request counter) + queue depth gauges
- [ ] `GET /metrics` (Prometheus, optional bearer token)
- [ ] `GET /api/v1/system/status` (uptime, health, p50/p95, cache ratio, page views, queues)
- [ ] Helmet security headers + CORS allow-list
- [ ] `packages/shared` API contract schemas
- [ ] Next.js portfolio pages (profile, projects, contact form) + page-view beacon (sends the
      path with its query string, so tagged links work, plus referrer, session id, time zone)
- [ ] Privacy notice page: what the analytics collect and why, with the DB-IP attribution
      (DESIGN.md §12)
- [ ] Live system telemetry dashboard (counts only; visitor details stay private)

## Phase 6: Continuous delivery (`feat/continuous-delivery`)

Design: [DESIGN.md §14](DESIGN.md#14-deployment--continuous-delivery-phase-6).

- [ ] Decide hosting + domain (default: one VPS running Docker Compose, Caddy for HTTPS and
      load balancing)
- [ ] `apps/api/Dockerfile` (multi-stage, non-root; one image for api/worker/migrate/seed;
      downloads the GeoIP files during the build), `apps/web/Dockerfile` (Next.js standalone),
      `.dockerignore`
- [ ] CI: build both images on every PR (a broken Dockerfile fails before merge)
- [ ] On merge to `main`: push images to GHCR tagged with the git SHA
- [ ] `deploy/compose.prod.yml` + `Caddyfile`; production env file kept on the host only
- [ ] `.github/workflows/deploy.yml`: migrate → seed → rolling update → smoke test → auto-rollback,
      behind a `production` GitHub Environment with a required reviewer (continuous **delivery**)
- [ ] Load balancing ([DESIGN.md §14.5](DESIGN.md#145-hosting-decided-at-the-start-of-phase-6)):
  - [ ] Two API replicas (`api-1`, `api-2`) behind Caddy: round robin, active health checks
  - [ ] `GET /health/live` liveness endpoint for the load balancer (no dependency checks) + tests
  - [ ] Rolling update: worker → api-1 (wait for `/health` = 200) → api-2 → web
  - [ ] Per-replica numbers: `instance` in system status; Prometheus scrapes each replica directly
  - [ ] Prove it: a request loop sees no failures while one replica is stopped, or during a deploy
- [ ] Nightly `pg_dump` backups off the host + a tested restore
- [ ] `docs/CD.md`: how to release, approve, roll back, read deploy logs
- [ ] Later: remove the approval gate (continuous **deployment**) once releases are routine
