# Roadmap & Progress

Each phase is built on its own branch, opened as a pull request, verified by CI, and merged
into `main` before the next phase starts. Design details live in [DESIGN.md](DESIGN.md).

| Phase | Branch                       | Module | Status         |
| ----- | ---------------------------- | ------ | -------------- |
| 1     | `main` (initial scaffold)    | —      | ✅ Done        |
| 2     | `feat/portfolio-cache-api`   | A      | ⏳ Next        |
| 3     | `feat/telemetry-pipeline`    | B      | ⬜ Not started |
| 4     | `feat/contact-rate-limiter`  | C      | ⬜ Not started |
| 5     | `feat/metrics-and-dashboard` | D      | ⬜ Not started |

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

## Phase 2: Portfolio content API + cache (`feat/portfolio-cache-api`)

- [ ] **CI first**: `.github/workflows/ci.yml` (format, lint, typecheck, unit + integration
      tests against Postgres/Redis service containers) — see [docs/CI.md](docs/CI.md)
- [ ] Migration `0001_portfolio_content.sql` (profile, experiences, projects)
- [ ] `content/portfolio.json` + `npm run content:seed` (upsert, then invalidate + warm cache)
- [ ] Model + repository + cache store + service + controller + view + routes for:
  - [ ] `GET /api/v1/profile`
  - [ ] `GET /api/v1/projects`
  - [ ] `GET /api/v1/projects/:slug`
- [ ] Redis cache-aside with TTL jitter, single-flight, `X-Cache: hit|miss` header
- [ ] Redis failure → Postgres fallback (log + metric)
- [ ] `infra/metrics.ts` prom-client registry: `cache_requests_total`, `cache_errors_total`,
      plus metrics for existing Redis reconnects / Postgres pool errors
- [ ] Unit tests (content service with fakes) + integration tests (real cache round trip)

## Phase 3: Telemetry pipeline (`feat/telemetry-pipeline`)

- [ ] Migration `0002_analytics_events.sql`
- [ ] `POST /api/v1/events` → validation, daily-salted visitor hash, bounded Redis buffer, `202`
- [ ] `worker.ts` entrypoint + telemetry batch flusher (claim → bulk insert → ack)
- [ ] Transient vs permanent error handling; poison events → DLQ
- [ ] `npm run dlq:replay`
- [ ] Worker graceful shutdown drains the buffer
- [ ] Integration tests: ingest → flush, crash recovery (no duplicates), DLQ, buffer cap,
      **worker SIGTERM graceful shutdown**

## Phase 4: Contact API + rate limiter (`feat/contact-rate-limiter`)

- [ ] Migration `0003_contact_messages.sql`
- [ ] Atomic Lua sliding-window rate limiter + `X-RateLimit-*` / `Retry-After` headers
- [ ] `POST /api/v1/contact` → persist `PENDING`, enqueue notification job, `202`
- [ ] Notification worker: reliable queue, exponential backoff, DLQ, `SENT`/`FAILED` status
- [ ] Notifiers: `log` (dev) and `discord`
- [ ] Reconciler for messages whose enqueue failed
- [ ] Tests: 20 concurrent requests admit exactly 3; retry/backoff/DLQ against a stub webhook

## Phase 5: Metrics & dashboard (`feat/metrics-and-dashboard`)

- [ ] HTTP metrics hook (duration histogram, request counter) + queue depth gauges
- [ ] `GET /metrics` (Prometheus, optional bearer token)
- [ ] `GET /api/v1/system/status` (uptime, health, p50/p95, cache ratio, page views, queues)
- [ ] Helmet security headers + CORS allow-list
- [ ] `packages/shared` API contract schemas
- [ ] Next.js portfolio pages (profile, projects, contact form) + page-view beacon
- [ ] Live system telemetry dashboard
