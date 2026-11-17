# System Design Specification: Personal Portfolio & Live Telemetry Platform

## 1. Overview & Goals
A production-grade personal portfolio platform engineered to demonstrate backend systems fundamentals: asynchronous ingestion, Redis caching and rate limiting, background job processing, observability, and clean testing practices.

## 2. Tech Stack & Monorepo Layout
- **Workspace:** npm workspaces (`apps/api`, `apps/web`)
- **Backend (`apps/api`):** TypeScript, Node.js, Fastify (with Zod/JSON Schema validation)
- **Frontend (`apps/web`):** Next.js (App Router), Tailwind CSS
- **Datastores:** PostgreSQL 16 (persistent storage), Redis 7 (cache, rate-limit state, event buffer, job queue)
- **Observability:** `prom-client` (Prometheus metrics) + custom JSON telemetry summary endpoint
- **Testing & CI:** Vitest + Supertest + Dockerized integration tests (or Testcontainers), GitHub Actions

## 3. Core Backend Modules & Requirements

### Module A: Portfolio Content API (Read-Through Cache)
- Serves structured profile, experience, and project metadata (`GET /api/v1/profile`, `GET /api/v1/projects`).
- Implements a **cache-aside (read-through)** pattern in Redis with configurable TTL and explicit cache invalidation / warm-up.
- Tracks cache hits vs. misses for live observability metrics.

### Module B: High-Throughput Analytics & Telemetry Pipeline
- **Ingestion (`POST /api/v1/events`):**
  - Accepts lightweight page-view and interaction events (`path`, `referrer`, `sessionHash`, `timestamp`).
  - Validates payload, hashes IP + User-Agent with a daily rotating salt (privacy-friendly, no raw PII stored).
  - Pushes event onto a **Redis List** (`telemetry:events:buffer`) via `RPUSH` and returns `202 Accepted` immediately (never blocks on Postgres).
- **Batch Flusher Worker:**
  - Runs on an interval (e.g., every 5s) OR when buffer reaches batch size (e.g., 50 events).
  - Atomically pops up to N items from Redis (`LPOP` / `LRANGE`+`LTRIM` or Lua script) and bulk-inserts into PostgreSQL `page_views`.
  - **Failure handling:** If Postgres write fails, re-queue or move to a dead-letter list (`telemetry:events:dlq`) rather than silently dropping data.
  - **Graceful shutdown:** On `SIGTERM`/`SIGINT`, flushes remaining buffered events before closing connections.

### Module C: Rate-Limited Contact & Async Notification API
- **Endpoint (`POST /api/v1/contact`):**
  - Protected by a **custom Redis Sliding-Window Rate Limiter** implemented via an atomic **Lua script** using Redis Sorted Sets (`ZSET`)—e.g., max 3 requests per 10 minutes per IP hash.
  - Returns standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` headers and `429 Too Many Requests` when exceeded.
  - Persists validated message into PostgreSQL `contact_messages` (`status = 'PENDING'`).
  - Enqueues a notification job into Redis (`jobs:notifications`) and returns `202 Accepted`.
- **Notification Worker:**
  - Consumes notification jobs and dispatches to a configured webhook (Telegram Bot API / Discord / Email stub in dev).
  - Implements **exponential backoff retries** (max 3 attempts) and moves permanently failed jobs to a Dead-Letter Queue (`jobs:notifications:dlq`) while updating DB status.

### Module D: Live System Status & Observability
- **Prometheus Endpoint (`GET /metrics`):** Exposes HTTP request duration histograms, total requests by route/status, Redis cache hit/miss counters, telemetry buffer depth, and DLQ sizes.
- **Dashboard Summary API (`GET /api/v1/system/status`):**
  - Returns live aggregated metrics for the frontend dashboard: uptime, DB/Redis health checks, rolling p50/p95 API latency, cache hit ratio, total page views (last 24h), and current queue/buffer depths.

## 4. Initial Data Model (PostgreSQL)
- `page_views`: `id (UUID)`, `path (TEXT)`, `referrer (TEXT)`, `visitor_hash (TEXT)`, `created_at (TIMESTAMPTZ)`
- `contact_messages`: `id (UUID)`, `name (TEXT)`, `email (TEXT)`, `message (TEXT)`, `ip_hash (TEXT)`, `status (ENUM: PENDING, SENT, FAILED)`, `attempts (INT)`, `created_at (TIMESTAMPTZ)`, `updated_at (TIMESTAMPTZ)`

## 5. Non-Functional & Engineering Standards
- **Layered Architecture:** `routes -> controllers/handlers -> services -> repositories` (no DB queries inside route handlers).
- **Config & Validation:** Fail-fast environment variable validation on startup (Zod).
- **Structured Logging:** JSON logs via Fastify's Pino logger with request IDs (`x-request-id`).
- **Testing:** Unit tests for rate limiter, batch flusher, and services; integration tests against real Postgres & Redis for end-to-end flows and graceful shutdown.
- **No silent fallbacks:** Every fallback, retry, or DLQ transition must emit a structured log and increment a metric.