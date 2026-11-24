# CLAUDE.md

Portfolio & live telemetry platform. **DESIGN.md is the source of truth**. Read the relevant
section before changing behaviour, and update it in the same change when a design decision moves.
It is about 2,300 lines, so don't read it whole: find the section with `grep -n '^##' DESIGN.md`,
or follow the `DESIGN.md §N` pointers in code comments and in the folder rules below.

## Where the rules are

This file holds what applies everywhere. Each folder below has its own CLAUDE.md, which Claude
Code loads the first time it reads or edits a file in that folder. A rule lives in one file
only: here if it applies everywhere, otherwise in the folder it governs.

| Folder                        | What's there                                                   | Its rules                                                             |
| ----------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/api`                    | Fastify API, background worker, CLIs, migrations, site content | [apps/api/CLAUDE.md](apps/api/CLAUDE.md)                              |
| `apps/web`                    | Next.js 16 website and the owner's `/admin`                    | [apps/web/CLAUDE.md](apps/web/CLAUDE.md) (imports Next's AGENTS.md)   |
| `packages/shared`             | the request/response contract (Zod) both apps import           | [packages/shared/CLAUDE.md](packages/shared/CLAUDE.md)                |
| `deploy`, `.github/workflows` | production stack, monitoring config, CI, the deploy pipeline   | [deploy/CLAUDE.md](deploy/CLAUDE.md) (`.github/CLAUDE.md` imports it) |
| `docs`                        | the owner's guides                                             | "Docs and workflow" below                                             |

## Environment

- Node **24 LTS** (`nvm use` reads `.nvmrc`), npm workspaces, Docker for Postgres 16 + Redis 7
  (+ Prometheus for `/admin`).
- First run: `cp .env.example .env && npm install && npm run infra:up && npm run db:migrate && npm run content:seed && npm run geoip:download`

## Commands (run from repo root)

| Task                                                 | Command                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| Start Postgres + Redis + Prometheus (waits for them) | `npm run infra:up` / `npm run infra:down`                        |
| Dev servers                                          | `npm run dev:api` (port 4000), `npm run dev:web` (port 3000)     |
| Rebuild `packages/shared` (or watch: `dev:shared`)   | `npm run build:shared` (dev/test/typecheck scripts run it first) |
| Worker (telemetry flusher, contact notifications)    | `npm run dev:worker`                                             |
| Apply migrations                                     | `npm run db:migrate`                                             |
| Publish `apps/api/content/portfolio.json`            | `npm run content:seed`                                           |
| Retry dead-lettered events / notifications           | `npm run dlq:replay -- telemetry` (or `-- notifications`)        |
| Download / refresh the GeoIP databases               | `npm run geoip:download` (gitignored `apps/api/data/geoip/`)     |
| Build the Docker images locally (docs/DOCKER.md)     | `npm run image:api` / `npm run image:web`                        |
| Production stack on the laptop (PRODUCTION-STACK.md) | `npm run stack:up` / `stack:down` / `stack:failover`             |
| Deploy a release to the stack, as CD does (CD.md)    | `npm run stack:deploy -- dev` (server: `deploy.sh <sha>`)        |
| Back up / restore the stack's database (BACKUPS.md)  | `npm run stack:backup` / `npm run stack:restore -- <file.dump>`  |
| Check monitoring config + alert tests (needs Docker) | `npm run monitoring:check`                                       |
| Lint / fix                                           | `npm run lint` / `npm run lint:fix`                              |
| Typecheck                                            | `npm run typecheck`                                              |
| Format                                               | `npm run format` / `npm run format:check`                        |
| All tests                                            | `npm test` (integration tests need `infra:up`)                   |
| Unit only / integration only                         | `npm run test:unit` / `npm run test:integration`                 |
| Single file (web: `-w @portfolio/web -- test/lib/…`) | `npm run test -w @portfolio/api -- test/unit/config/env.test.ts` |
| Everything CI runs                                   | `npm run check`, then `npm run build -w @portfolio/web`          |

## Rules for every package

- Strict mode plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`, no
  non-null `!` assertions. Validate external input with Zod at the boundary.
- Use `import type` for type-only imports (`verbatimModuleSyntax`).
- ESM everywhere, but relative imports differ by package: `apps/api` and `packages/shared` use
  `NodeNext` resolution, so they end in `.js`; `apps/web` uses `Bundler` resolution, so they
  have no extension, and `@/` is `src/`.
- Prefer small files with one responsibility and descriptive names over clever abstractions.
  Readability wins ties.
- Comments explain _why_, not _what_.
- Never log secrets, raw IPs, or bodies.
- What the site records about visitors and senders is spelled out in the privacy notice
  (`apps/web/src/app/privacy/page.tsx`, DESIGN.md §12): change it in the same change as
  anything that alters what is collected.
- Every new behaviour ships with tests; every bug fix ships with a regression test.

## Docs and workflow

Phases 1–7 are done and live (DESIGN.md §13). [README.md](README.md) lists the guides in
`docs/`: update a guide in the same change when a command, a flow or a file it describes
changes.

One phase per branch → pull request → CI green → merge. Stop for review between phases.
Each phase adds a "what to watch" section to `docs/DATA-TOOLS.md` (Postgres/Redis VS Code views).
