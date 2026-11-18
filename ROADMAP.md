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
- [x] `apps/api/Dockerfile` (multi-stage, non-root; one image for api/worker/migrate/seed;
      builds `packages/shared`; downloads the GeoIP files during the build),
      `apps/web/Dockerfile` (Next.js `output: 'standalone'`; built with an empty
      `NEXT_PUBLIC_API_BASE_URL`, so browsers call the same origin, DESIGN.md §14.2),
      `.dockerignore`; both built and run locally (API, worker, CLIs, site), guide
      [docs/DOCKER.md](docs/DOCKER.md), `npm run image:api` / `image:web`
- [x] CI: build both images for `linux/arm64` on GitHub's Arm runners on every PR (a broken
      Dockerfile fails before merge); layers cached in the Actions cache
- [ ] On merge to `main`: push images to GHCR tagged with the git SHA
- [ ] `deploy/compose.prod.yml` + `Caddyfile` (path routing, internal `:8080` listener for the
      web server); production env file kept on the host only
- [ ] `.github/workflows/deploy.yml`: migrate → seed → rolling update → smoke test → auto-rollback,
      behind a `production` GitHub Environment with a required reviewer (continuous **delivery**)
- [ ] Load balancing ([DESIGN.md §14.5](DESIGN.md#145-hosting-oracle-cloud-free-tier-one-hostname)):
  - [ ] Two API replicas (`api-1`, `api-2`) behind Caddy: round robin, active health checks
  - [x] `GET /health/live` liveness endpoint for the load balancer (no dependency checks) + tests
        (200 with both datastores down, no info logs, left out of the dashboard's latency;
        305 API + 74 web tests)
  - [ ] Rolling update: worker → api-1 (wait for `/health` = 200) → api-2 → web
  - [ ] Per-replica numbers: Prometheus scrapes each replica directly (`instance` in the system
        status already exists since Phase 5; set each container's hostname to `api-1`/`api-2`)
  - [ ] Prove it: a request loop sees no failures while one replica is stopped, or during a deploy
- [ ] Nightly `pg_dump` backups off the host + a tested restore
- [ ] Switch to `<name>.is-a.dev` once the site is live (you write the request by hand: their
      terms forbid AI-written pull requests)
- [ ] `docs/CD.md`: how to release, approve, roll back, read deploy logs
- [ ] Later: remove the approval gate (continuous **deployment**) once releases are routine

### Website polish before going live (feedback, 2026-11-18)

- [x] Plainer look: no terminal imitation (`~/yicheng $ whoami`, `./` prefixes, `$ command`
      lines, faux window bars), sans-serif text; the hero's JSON card and the rate-limiter lab
      removed; no GitHub links (profile and this site's repository)
- [x] Project cards: the whole card opens the project, hover lift instead of the pointer glow,
      "Read more →", keyboard focus outline
- [x] Project pages: structured `sections` (migration `0006_project_sections.sql`, response
      field, `cache:v2:project:<slug>`), "On this page" list, large "Back to projects" button
      at the top and bottom, link to the next project
- [x] Project details written for Orbital (from the MS3 README), Brainhack (from the
      object-detection notebook) and this site
- [x] Tests: content-file rules for sections, project detail with and without sections,
      section anchors, next project, paragraphs
- [x] Footer line "Built with …" and the public Status link removed

### Owner area (`/admin`, 2026-11-18)

- [x] System status is owner-only: `GET /api/v1/admin/system-status` (bearer `ADMIN_TOKEN`);
      the public `/status` page, header link and hero pill are gone
- [x] Visitor summary `GET /api/v1/admin/visitors?days=` (DESIGN.md §7.8): visits grouped by
      session, referrers, tagged links, places, organisations, devices, browsers, pages,
      clicks, recent visits; bots and `/admin` excluded
- [x] `/admin` page behind HTTP Basic (`proxy.ts` + a second check in the page and its route),
      `no-store` + `noindex`; period picker; the owner's browser is not counted
- [x] Status charts: 30-minute time axis with a labelled tick every 5 minutes
- [x] Tests: owner endpoints (401/200/404, contract), summary aggregation (bots, `/admin`,
      older events left out), manager ranking and day filling, login check, `shouldRecord`,
      time ticks and gaps (300 API + 57 web total)
- [ ] Production: Caddy refuses `/api/v1/admin/*` from outside (in `deploy/Caddyfile`, 6b)

### Warmer design and photos (2026-11-18)

- [x] Light, warm theme from named tokens (`globals.css`), Fraunces headings, terracotta
      accent; no graph-paper grid or pointer glow
- [x] Photos: portrait in the hero, avatar in the header, "Outside work" gallery
      (`content/photos.ts`); web copies resized and stripped of metadata
- [x] Icons: section titles, timeline (work / study), cards, buttons; `app/icon.svg` tab icon
      and `app/apple-icon.png`
- [x] Bug: a second click on a header section link did nothing (Next.js `<Link>` and an
      unchanged `#hash`); `SectionLink` scrolls on every click + regression test
- [x] Contact form explains the spam limit ("3 messages per person every 10 minutes, so you
      can send 2 more"): new `X-RateLimit-Window` header
- [x] Flaky test fixed: the notification retry test now moves a fake clock instead of racing
      a 10 ms backoff (300 API + 63 web tests)
- [x] Hero fades only once 60 % of it has scrolled away; "Outside work" became a turning
      photo carousel (buttons, dots, side-photo clicks, ← →, swipe) (300 API + 68 web tests)
- [x] Hero photo collage (seven tilted prints, `HERO_PHOTOS`); graduation photo in the carousel
- [x] Privacy page removed (owner's decision); projects moved from `/projects/<slug>` to
      `/<slug>` with permanent redirects; no separate projects list; reserved slugs refused
- [x] IP addresses stored (owner's choice): migration `0007_analytics_ip_address.sql` (`INET`),
      buffered event `ipAddress`, shown per visit on `/admin` (302 API + 68 web tests)
- [ ] Retention rule for IP addresses (e.g. clear after 30 days)
- [x] Bugs: the name in the header did nothing on the home page (now scrolls to the top);
      "About" stayed highlighted after scrolling back to the hero (scrollspy now clears);
      regression tests for both (302 API + 74 web tests)
- [x] `/admin` explains its numbers: what visits, page views and link clicks are (plus a
      "How they are counted" note), what each list and status tile measures, a content-cache
      card (hit, miss, why a low ratio is fine) and a plain-words queue card with Redis keys
      and replay commands; stale "IP never stored" footnote fixed
- [x] Faint lines (1.3:1, nearly invisible in Chrome on Windows): `line` and `line-strong`
      darkened, form inputs outlined in a new `field` token at 3.3:1 (WCAG 1.4.11)
