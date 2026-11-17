# Roadmap & Progress

Each phase is built on its own branch, opened as a pull request, verified by CI, and merged
into `main` before the next phase starts. Design details live in [DESIGN.md](DESIGN.md).

| Phase | Branch                       | Module | Status         |
| ----- | ---------------------------- | ------ | -------------- |
| 1     | `main` (initial scaffold)    | —      | ✅ Done        |
| 2     | `feat/portfolio-cache-api`   | A      | 🔍 In review   |
| 3     | `feat/telemetry-pipeline`    | B      | ⬜ Not started |
| 4     | `feat/contact-rate-limiter`  | C      | ⬜ Not started |
| 5     | `feat/metrics-and-dashboard` | D      | ⬜ Not started |
| 6     | `feat/continuous-delivery`   | —      | ⬜ Not started |

---

## Phase 1: Project skeleton & infrastructure ✅

- [x] npm workspaces monorepo (`apps/api`, `apps/web`), Node 24 LTS (`.nvmrc`)
- [x] Strict `tsconfig.base.json`, ESLint (type-aware) + Prettier
- [x] `docker-compose.yml`: Postgres 16 + Redis 7, healthchecks, named volumes
- [x] `.env.example` + fail-fast Zod config loader
- [x] Fastify app in MVC layout (routes → controllers → services → models/repositories, views)
- [x] Pino structured logging + `x-request-id` correlation
- [x] Consistent error envelope `{ error: { code, message, requestId } }`
- [x] `pg` pool + `ioredis` client with fail-fast startup
- [x] SQL migration runner (advisory lock, per-file transactions, checksums) + `db:migrate`
- [x] Graceful `SIGTERM`/`SIGINT` shutdown with forced-exit deadline
- [x] `GET /health` checking live Postgres + Redis
- [x] Next.js 16 + Tailwind 4 placeholder page
- [x] Tests: 32 unit + 12 integration (incl. real-process SIGTERM test)

## Phase 2: Portfolio content API + cache (`feat/portfolio-cache-api`) 🔍

- [x] **CI first**: `.github/workflows/ci.yml` (format, lint, typecheck, unit + integration
      tests against Postgres/Redis service containers) — see [docs/CI.md](docs/CI.md)
- [x] Migration `0001_portfolio_content.sql` (profile, experiences, projects)
- [x] `content/portfolio.json` + `npm run content:seed` (upsert, then invalidate + warm cache)
- [x] Model + repository + cache store + service + controller + view + routes for:
  - [x] `GET /api/v1/profile`
  - [x] `GET /api/v1/projects`
  - [x] `GET /api/v1/projects/:slug`
- [x] Redis cache-aside with TTL jitter, single-flight, `X-Cache: hit|miss` header
- [x] Redis failure → Postgres fallback (log + metric)
- [x] `infra/metrics.ts` prom-client registry: `cache_requests_total`, `cache_errors_total`,
      plus metrics for existing Redis reconnects / Postgres pool errors
- [x] Unit tests (cache-aside, content service, content file schema) + integration tests
      (real cache round trip, Redis-down fallback, seed CLI) — 55 unit + 22 integration total
- [x] Data-viewer guide: [docs/DATA-TOOLS.md](docs/DATA-TOOLS.md) (VS Code PostgreSQL + Redis)
- [x] PR #1 merged: CI workflow only (green on PR and on `main`)
- [ ] Feature commit pushed, PR #2 opened, CI green, merged into `main`

## Phase 3: Telemetry pipeline (`feat/telemetry-pipeline`)

- [ ] Migration `0002_analytics_events.sql`
- [ ] `POST /api/v1/events` → validation, daily-salted visitor hash, bounded Redis buffer, `202`
- [ ] `worker.ts` entrypoint + telemetry batch flusher (claim → bulk insert → ack)
- [ ] Transient vs permanent error handling; poison events → DLQ
- [ ] `npm run dlq:replay`
- [ ] Worker graceful shutdown drains the buffer
- [ ] Integration tests: ingest → flush, crash recovery (no duplicates), DLQ, buffer cap,
      **worker SIGTERM graceful shutdown**
- [ ] DATA-TOOLS.md §7: watching the buffer drain into `analytics_events`

## Phase 4: Contact API + rate limiter (`feat/contact-rate-limiter`)

- [ ] Migration `0003_contact_messages.sql`
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
- [ ] Next.js portfolio pages (profile, projects, contact form) + page-view beacon
- [ ] Live system telemetry dashboard

## Phase 6: Continuous delivery (`feat/continuous-delivery`)

Design: [DESIGN.md §14](DESIGN.md#14-deployment--continuous-delivery-phase-6).

- [ ] Decide hosting + domain (default: one VPS running Docker Compose with Caddy for HTTPS)
- [ ] `apps/api/Dockerfile` (multi-stage, non-root; one image for api/worker/migrate/seed),
      `apps/web/Dockerfile` (Next.js standalone), `.dockerignore`
- [ ] CI: build both images on every PR (a broken Dockerfile fails before merge)
- [ ] On merge to `main`: push images to GHCR tagged with the git SHA
- [ ] `deploy/compose.prod.yml` + `Caddyfile`; production env file kept on the host only
- [ ] `.github/workflows/deploy.yml`: migrate → seed → roll out → smoke test → auto-rollback,
      behind a `production` GitHub Environment with a required reviewer (continuous **delivery**)
- [ ] Nightly `pg_dump` backups off the host + a tested restore
- [ ] `docs/CD.md`: how to release, approve, roll back, read deploy logs
- [ ] Later: remove the approval gate (continuous **deployment**) once releases are routine
