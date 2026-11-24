# apps/api: the API, the worker and their CLIs

One codebase and one Docker image for several processes (DESIGN.md §2.1, §14.2): the Fastify
API (`src/main.ts`), the background worker (`src/worker.ts`) and the CLIs in `src/cli/` (migrate,
seed content, replay dead letters, download the GeoIP files).

**In DESIGN.md**, read §2.2 (layering), then the section for what you're changing: an endpoint
§7 (its schema lives in `packages/shared`), a table §5, a Redis key §6 (key catalog §6.2),
content and its cache §8.1, telemetry §8.2, contact and notifications §8.3, metrics §8.5,
failure handling §9, shutdown §10, tests §11, privacy §12.

## Layers (DESIGN.md §2.2)

- **Request flow**: `controllers/ → services/ (managers) → dal/` with `views/` shaping
  responses. One file per resource per layer, named `<resource>.<layer>.ts`
  (e.g. `content.controller.ts`, `content.manager.ts`, `content.dal.ts`).
  - `controllers/`: `register<Resource>Controller(app, manager)` declares the endpoints
    (method + path), validates input with `parseRequest`, calls **one** manager method, picks
    the status code, renders a view. No business rules, no SQL, no Redis.
  - `services/*.manager.ts`: business rules. No Fastify request/reply objects, no SQL.
  - `dal/*.dal.ts`: the only datastore code (Postgres, Redis or local GeoIP files; say which
    in the file comment). Reads return `schema/` types, mapped from `dao/` rows.
  - `workers/*.worker.ts`: background loops started by `src/worker.ts`. The worker's
    "controllers": decide _when_ to run, call one manager method, back off on failure.
  - `dao/*.dao.ts`: row types, one interface per table, column for column (`snake_case`).
  - `schema/*.schema.ts`: Zod schemas + types for responses, requests and input files.
  - `views/`: build response bodies (`{ data }`, `{ error }`); never leak internal fields.
  - `middleware/`: cross-cutting hooks. Route hooks (`rateLimit`, `requireBearerToken`) run
    in `onRequest` and may call their own manager, so the handler still calls one.
- **Public contract**: request/response Zod schemas come from `packages/shared` (both the API
  and the web app import them); the `schema/` files re-export them and keep internal shapes
  (buffered events, jobs, the content file) to themselves.
- **Composition root**: `src/main.ts` (API) and `src/worker.ts` (worker) build infra clients;
  `src/app.ts` wires DAL → managers → controllers, `worker.ts` wires DAL → managers → worker
  loops, and `src/worker-app.ts` the worker's one HTTP route (`GET /metrics`). No module-level
  singletons.

## Errors, logs and metrics

- **Errors**: throw `AppError` (`src/errors/app-error.ts`) for expected failures. The error
  handler renders `{ error: { code, message, requestId } }` via `views/error.view.ts`.
- **Success responses** are `{ data: ... }` (except `/health` and `/metrics`).
- **No silent failures**: every retry, fallback, swallowed error, or DLQ move must emit a
  structured log **and** increment a metric (`infra/metrics.ts` from Phase 2). Never write an
  empty `catch`.
- **Logging**: use the injected Pino logger (`request.log` inside handlers) with an object
  first: `log.warn({ err, attempt }, 'redis reconnecting')`.
- **Metric labels** take bounded values: the route template (`/api/v1/projects/:slug`), never a
  raw path or an IP address (§8.5, §15.4).

## Changes that must survive a deploy

A deploy runs the migrations first, then replaces the worker and the two API replicas one at a
time: the old code meets the new schema, and old and new code share Redis (DESIGN.md §14.3–14.5).

- **Migrations**: new numbered file in `apps/api/migrations/`; never edit an applied one
  (checksums are verified). Migrations run via CLI, never on app boot. They must be
  **backward compatible** with the previously deployed code (expand → contract, DESIGN.md §14.4).
- **Cached responses**: when a response changes shape, its cache key gets a new version
  (`cache:v3:profile` → `cache:v4:profile`, §6.2).
- **Buffered events**: the new worker flushes what the previous release buffered, so a field
  added to a buffered event needs a default (§9).
- **Request and response shapes**: see `packages/shared/CLAUDE.md`.

## Tests (DESIGN.md §11, docs/TESTING.md)

- Unit tests (`test/unit`, folders mirror `src/`) must not touch the network or filesystem
  state.
- Integration tests (`test/integration`) use the real docker-compose services: database
  `portfolio_test` (created automatically) and Redis DB `1`. Never flush Redis DB `0`.
