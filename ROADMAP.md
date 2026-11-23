# Roadmap & Progress

Each phase is built on its own branch, opened as a pull request, verified by CI, and merged
into `main` before the next phase starts. Design details live in [DESIGN.md](DESIGN.md).

| Phase | Branch                       | Module | Status                      |
| ----- | ---------------------------- | ------ | --------------------------- |
| 1     | `main` (initial scaffold)    | —      | ✅ Done                     |
| 2     | `feat/portfolio-cache-api`   | A      | ✅ Done                     |
| 3     | `feat/telemetry-pipeline`    | B      | ✅ Done                     |
| 4     | `feat/contact-rate-limiter`  | C      | ✅ Done                     |
| 5     | `feat/metrics-and-dashboard` | D      | ✅ Done                     |
| 6     | `feat/continuous-delivery`   | —      | ✅ Live (backups to set up) |

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

Design: [DESIGN.md §14](DESIGN.md#14-deployment--continuous-delivery-phase-6). Guides:
[HOSTING](docs/HOSTING.md), [DOCKER](docs/DOCKER.md), [PRODUCTION-STACK](docs/PRODUCTION-STACK.md),
[CD](docs/CD.md), [BACKUPS](docs/BACKUPS.md).

- [x] Hosting decided: Oracle Cloud Always Free Arm VM (1 OCPU, 6 GB) with Docker Compose and
      Caddy; one free hostname (DuckDNS now, is-a.dev later): `/api/*` → API, the rest → website
- [x] Server ready (checked over SSH, 2026-11-20): Ubuntu 24.04 on Arm, automatic security
      updates, both firewalls, Docker 29.10 + Compose v5.8, key-only SSH, ports 80/443 reach a
      container from the internet. 1 OCPU because 2 was refused (out of host capacity).
      Learned: Docker's published ports bypass the VM's `INPUT` rules
- [x] 6a Docker images: one API image (API, worker, CLIs; GeoIP files inside, non-root) and a
      standalone web image with no hostname inside; CI builds both for `linux/arm64` on every PR
- [x] 6b Production stack (`deploy/compose.prod.yml`, Caddyfile): two API replicas behind Caddy
      (round robin, `/health/live` every 5 s, retries, `dial_timeout 1s`); secrets only in the
      host's `deploy/.env`. Failover test: 0 failed of 2,779 requests while replicas were
      stopped and replaced (`npm run stack:failover`)
- [x] 6c Continuous delivery: merge → CI → images to GHCR (tag = commit SHA) → your approval →
      `deploy/deploy.sh` over SSH: migrate, seed, rolling update (worker → api-1 → api-2 → web),
      smoke test, automatic rollback. Tested on the laptop stack (all 503 API requests
      succeeded during a deploy, all 1,302 during a rollback) and checked against the server's
      versions. Found and fixed: Compose's `up --wait` lets through a container that is still
      starting
- [x] 6d Weekly backups: dump + test restore on the server, copied to the desktop with a
      read-only key; restore swaps databases in one transaction. Drill passed on the laptop
- [x] One-time deploy setup (2026-11-20, [CD.md §2](docs/CD.md#2-one-time-setup-about-20-minutes)):
      deploy key, `~/portfolio/deploy/.env`, GitHub `production` environment (you approve,
      `main` only). Learned: a key pasted through the clipboard broke ("error in libcrypto");
      the secret is now set from the file, and the job checks the key first
- [x] **Live** (2026-11-20): first deploy in 87 s on the server, smoke test and the check from
      the internet passed. Memory: about 600 MB for the whole stack (`docker stats`)
- [x] Pause switch: `deploy/caddy/paused` on the server → a "back soon" page (503 +
      `Retry-After`), `/admin` stays open, deploys still work and leave it paused
      ([CD.md §5](docs/CD.md#5-pausing-the-site)). Tested on the laptop stack, failures included,
      then on the server (2026-11-21)
- [x] PR #7 merged (Phase 6, 2026-11-20) and PR #8 (pause switch, deployed in 39 s, 2026-11-21)
- [x] Backups switched on (2026-11-22, [BACKUPS.md §2–3](docs/BACKUPS.md)): the server's
      weekly cron job (first backup by hand, test restore passed), the desktop's read-only key
      and first copy. The copy home is by hand, whenever the owner likes, not scheduled (owner's
      choice). Found and fixed: the copy's freshness check did not look inside the linked
      backups folder and called a fresh backup missing (`find -H`, regression test
      `pull-backups-script.test.ts`)
- [x] After a restore, copy back the visits and messages that arrived after the backup
      ([BACKUPS.md §4](docs/BACKUPS.md#bringing-back-the-visits-and-messages-that-came-after-the-backup)):
      drilled on the desktop stack (2026-11-22), a rerun adds nothing. Also fixed: the server
      shortcut `C="docker compose -f ~/…"` in the docs (a quoted `~` is not expanded: `$HOME`)
- [ ] Oracle idle rule: Oracle's Memory utilization reads about 22 % (2026-11-20, first hour),
      just above the 20 % line; CPU about 5 %. Recheck the 7-day view in a week; resize to
      3 GB if memory falls under 20 % ([HOSTING.md](docs/HOSTING.md#check-yourself), question 3)
- [x] Protect `main` (2026-11-20, ruleset "Protect main"): pull request required, checks
      `check`, `image (api)` and `image (web)` required, no force push or deletion, no bypass
      ([CI.md §4](docs/CI.md#4-protecting-main))
- [ ] Per-replica metrics in a Prometheus server (each replica already reports its `instance`)
- [ ] Switch to `<name>.is-a.dev`, possible now that the site is live (you write the request by
      hand: their terms forbid AI-written pull requests)
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
- [x] Production: Caddy refuses `/api/v1/admin/*` from outside (`deploy/caddy/Caddyfile`, 6b;
      checked with the token, also as `/api/v1/%61dmin/…`, `/api/v1//admin/…`, `/API/…`)
- [x] Bug (owner's feedback, 2026-11-22): the system status's numbers flipped between the two
      API replicas on every poll, so the request chart zigzagged 0, 1, 0, 1. The dashboard now
      combines the replicas' latest readings: requests and cache counts added up, latency from
      the slower one, uptime from the latest start (`combineReplicas`, regression test in
      `status.test.ts`)

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
- [x] Retention of IP addresses decided (2026-11-19): kept indefinitely, no notice to visitors
      (owner's decision; DESIGN.md §12)
- [x] Bugs: the name in the header did nothing on the home page (now scrolls to the top);
      "About" stayed highlighted after scrolling back to the hero (scrollspy now clears);
      regression tests for both (302 API + 74 web tests)
- [x] `/admin` explains its numbers: what visits, page views and link clicks are (plus a
      "How they are counted" note), what each list and status tile measures, a content-cache
      card (hit, miss, why a low ratio is fine) and a plain-words queue card with Redis keys
      and replay commands; stale "IP never stored" footnote fixed
- [x] Faint lines (1.3:1, nearly invisible in Chrome on Windows): `line` and `line-strong`
      darkened, form inputs outlined in a new `field` token at 3.3:1 (WCAG 1.4.11)

### "Last updated" dates (2026-11-21)

- [x] Every visitor page ends with "Last updated 21 November 2026": the home page says when
      any content last changed, a project page when that project did (migration
      `0008_content_updated_at.sql`; cache keys `cache:v3:profile`, `cache:v3:project:<slug>`)
- [x] The seed writes only what changed (`IS DISTINCT FROM`; a project's new position counts),
      so a deploy no longer moves every date; it logs `"changed": true | false`
      (313 API + 75 web tests)
- [x] The last project page no longer leads back to the first: only "Back to projects"
      (owner's feedback; regression test in `project-page.test.ts`)

### Fixes after launch (2026-11-22)

- [x] Flaky CI: the worker sometimes exited with code 1 when stopped (`worker-process.test.ts`,
      the merge of PR #13). Its shutdown closed the blocking Redis connection with `QUIT` right
      after the consumer had cut it, while ioredis still reported it `ready`. Now it is only
      disconnected (`closeInterruptedRedis`; regression test `redis-close.test.ts`). The worker
      test now prints the worker's log when it fails, and waits for that log to be complete.

### What is in a queue, and two chart fixes (2026-11-23)

- [x] "Show items" on `/admin`'s queue card: what waits in each queue, read on request (newest
      20; the retries by due time) without taking anything out. Visits: when, which page or
      click, who. Notifications: who wrote, the message, which try, when the next is due. Dead
      letters: why, when, the exact error, and "Before retrying", one fix per reason.
      `GET /api/v1/admin/queues/:queue` (DESIGN.md §7.8), `queue-items.manager.ts`, DAL peeks
- [x] The card's retry commands work on the server (`docker compose … run --rm replay-dlq`), not
      only `npm run dlq:replay` on a computer; the fixes per reason are in PROJECT-GUIDE.md §8
- [x] Bug (owner's feedback): the chart's hover dot sat below the axis for a 0, and too low for
      every other value: it was placed in a box that also held the time labels. The plot box is
      now exactly the chart's size, and the line and the dot share `valueDepth` (regression
      test in `status.test.ts`)
- [x] Bug (owner's feedback): each load of `/admin` added one request to its own "requests ·
      5 min". Next.js prefetched the home page's title for the header's links, which asks the
      API for the profile (reproduced against a production build). Links to the home page no
      longer prefetch (`prefetch={false}`, DESIGN.md §8.6)
- [x] Project cards and "Next project" no longer prefetch either: each card on screen asked the
      API for its project's title, so one home-page visit counted several requests. ESLint now
      fails a `<Link>` without a `prefetch` prop (the regression guard for both fixes)
