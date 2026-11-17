# CLAUDE.md

Portfolio & live telemetry platform. **DESIGN.md is the source of truth**. Read the relevant
section before changing behaviour, and update it in the same change when a design decision moves.

## Environment

- Node **24 LTS** (`nvm use` reads `.nvmrc`), npm workspaces, Docker for Postgres 16 + Redis 7.
- First run: `cp .env.example .env && npm install && npm run infra:up && npm run db:migrate && npm run content:seed`

## Commands (run from repo root)

| Task                                            | Command                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Start Postgres + Redis (waits for healthchecks) | `npm run infra:up` / `npm run infra:down`                        |
| Dev servers                                     | `npm run dev:api` (port 4000), `npm run dev:web` (port 3000)     |
| Apply migrations                                | `npm run db:migrate`                                             |
| Publish `apps/api/content/portfolio.json`       | `npm run content:seed`                                           |
| Lint / fix                                      | `npm run lint` / `npm run lint:fix`                              |
| Typecheck                                       | `npm run typecheck`                                              |
| Format                                          | `npm run format` / `npm run format:check`                        |
| All tests                                       | `npm test` (integration tests need `infra:up`)                   |
| Unit only / integration only                    | `npm run test:unit` / `npm run test:integration`                 |
| Single file                                     | `npm run test -w @portfolio/api -- test/unit/config/env.test.ts` |
| Everything CI runs                              | `npm run check`                                                  |

## Architecture rules (MVC, see DESIGN.md §2.2)

- **Request flow**: `routes/ → controllers/ → services/ → repositories/` with `views/` shaping
  responses. One file per resource per layer, named `<resource>.<layer>.ts`
  (e.g. `content.controller.ts`, `content.service.ts`, `content.repository.ts`).
  - `routes/`: URL table only (method, path, schema → controller function).
  - `controllers/`: read the request, call **one** service method, pick the status code,
    render a view. No business rules, no SQL, no Redis.
  - `services/`: business rules. No Fastify request/reply objects, no SQL.
  - `models/`: domain types + Zod schemas.
  - `repositories/`: the only datastore code. SQL in `*.repository.ts`, Redis in `*.store.ts`.
  - `views/`: build response bodies (`{ data }`, `{ error }`); never leak internal fields.
- **Composition root**: `src/main.ts` (and `src/worker.ts` from Phase 3) build infra clients;
  `src/app.ts` wires services → controllers → routes. No module-level singletons.
- **Errors**: throw `AppError` (`src/errors/app-error.ts`) for expected failures. The error
  handler renders `{ error: { code, message, requestId } }` via `views/error.view.ts`.
- **Success responses** are `{ data: ... }` (except `/health` and `/metrics`).
- **No silent failures**: every retry, fallback, swallowed error, or DLQ move must emit a
  structured log **and** increment a metric (`infra/metrics.ts` from Phase 2). Never write an
  empty `catch`.
- **Migrations**: new numbered file in `apps/api/migrations/`; never edit an applied one
  (checksums are verified). Migrations run via CLI, never on app boot. They must be
  **backward compatible** with the previously deployed code (expand → contract, DESIGN.md §14.4).

## TypeScript & style

- Strict mode plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`, no
  non-null `!` assertions. Validate external input with Zod at the boundary.
- ESM with `NodeNext` resolution: relative imports end in `.js`.
- Use `import type` for type-only imports (`verbatimModuleSyntax`).
- Prefer small files with one responsibility and descriptive names over clever abstractions.
  Readability wins ties.
- Comments explain _why_, not _what_.
- Logging: use the injected Pino logger (`request.log` inside handlers) with an object first:
  `log.warn({ err, attempt }, 'redis reconnecting')`. Never log secrets, raw IPs, or bodies.

## Testing

- Unit tests (`apps/api/test/unit`, folders mirror `src/`) must not touch the network or
  filesystem state.
- Integration tests (`apps/api/test/integration`) use the real docker-compose services:
  database `portfolio_test` (created automatically) and Redis DB `1`. Never flush Redis DB `0`.
- Every new behaviour ships with tests; every bug fix ships with a regression test.

## Roadmap & workflow

Phases and live progress checklists: [ROADMAP.md](ROADMAP.md). Tick items there as they land.

1. **Skeleton & infra**: done (`main`)
2. `feat/portfolio-cache-api`: CI workflow, profile/projects API, Redis cache-aside, cache metrics
3. `feat/telemetry-pipeline`: event ingestion, Redis buffer, batch flusher worker, DLQ
4. `feat/contact-rate-limiter`: Lua sliding-window limiter, contact API, notification worker
5. `feat/metrics-and-dashboard`: `/metrics`, system status API, Next.js portfolio + dashboard
6. `feat/continuous-delivery`: Docker images, GHCR, deploy workflow with approval gate, rollback

One phase per branch → pull request → CI green → merge. Stop for review between phases.
Each phase adds a "what to watch" section to `docs/DATA-TOOLS.md` (Postgres/Redis VS Code views).
