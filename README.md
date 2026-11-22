# Portfolio & Live Telemetry Platform

My portfolio website, built like a small production system: a Next.js site on a Fastify API
with a Redis cache, an analytics pipeline with a batch worker, a rate-limited contact form with
background notifications, and an owner dashboard. Releases go to an Oracle Cloud VM after my
approval, with automatic rollback. Live since 2026-11-20.

**Coming back, or wondering how to do something? [docs/START-HERE.md](docs/START-HERE.md)**:
from "I want to…" to the command and the guide.
**How it all works: [docs/PROJECT-GUIDE.md](docs/PROJECT-GUIDE.md)**, the whole project on one
page (architecture, code flows with diagrams, using and editing the site, reading the data,
interview notes).

| Guide                                                                   | For                                   |
| ----------------------------------------------------------------------- | ------------------------------------- |
| [Start here](docs/START-HERE.md)                                        | "How do I…?": every task, where to go |
| [DESIGN.md](DESIGN.md)                                                  | The full specification                |
| [ROADMAP.md](ROADMAP.md)                                                | Progress, phase by phase              |
| [Guided tour](docs/GUIDED-TOUR.md)                                      | Hands-on: try every feature locally   |
| [Editing the site](docs/EDITING-THE-SITE.md)                            | Text, page wording, photos            |
| [Content & cache](docs/CONTENT-AND-CACHE.md)                            | The content API and its Redis cache   |
| [Data tools](docs/DATA-TOOLS.md)                                        | Postgres and Redis in VS Code         |
| [Testing](docs/TESTING.md) · [CI](docs/CI.md)                           | Tests and GitHub Actions              |
| [Docker](docs/DOCKER.md) · [Production stack](docs/PRODUCTION-STACK.md) | Images; the real stack on your laptop |
| [Hosting](docs/HOSTING.md) · [Releasing](docs/CD.md)                    | The server; deploying, pausing        |
| [Backups](docs/BACKUPS.md)                                              | Weekly backups and restoring          |

## Quick start

Requires Node 24 (via [nvm](https://github.com/nvm-sh/nvm)) and Docker.

```bash
nvm use                  # Node 24 from .nvmrc
npm install
cp .env.example .env
npm run infra:up         # Postgres 16 + Redis 7 in Docker
npm run db:migrate       # create the tables
npm run content:seed     # load apps/api/content/portfolio.json
npm run geoip:download   # free IP → organisation/location files (~65 MB)

npm run dev:api          # API    → http://localhost:4000/api/v1/projects
npm run dev:worker       # worker → events to Postgres, contact notifications
npm run dev:web          # site   → http://localhost:3000 (owner page: /admin)
```

Each `dev:*` command runs in its own terminal.

## Common commands

| Command                           | What it does                                         |
| --------------------------------- | ---------------------------------------------------- |
| `npm run check`                   | Format, lint, typecheck, tests (what CI runs)        |
| `npm test` / `npm run test:unit`  | All tests (needs `infra:up`) / unit tests only       |
| `npm run content:seed`            | Publish edits to `apps/api/content/portfolio.json`   |
| `npm run dlq:replay -- telemetry` | Retry dead-lettered events (or `-- notifications`)   |
| `npm run geoip:download`          | Refresh the IP databases (monthly), then restart API |
| `npm run image:api` / `image:web` | Build the production Docker images                   |
| `npm run stack:up` / `stack:down` | Run the production stack locally (https://localhost) |
| `npm run stack:deploy -- dev`     | Deploy to that stack the way the server does         |
| `npm run infra:down`              | Stop the Docker datastores (data is kept)            |

## Working on another machine

Everything needed lives in Git; the database is rebuilt from migrations and `portfolio.json`.
Push your branch on the old machine, then on the new one (with Git, Docker, nvm + Node 24):

```bash
git clone https://github.com/zhuuyicheng/yicheng-website.git && cd yicheng-website
git switch <your-branch>
nvm install && npm ci && cp .env.example .env
npm run infra:up && npm run db:migrate && npm run content:seed && npm run geoip:download
npm run check            # confirms the setup
```

## Repository layout

```
packages/shared  The API contract: Zod schemas both apps import
apps/api         Fastify API (controllers → managers → DAL) and the background worker
apps/web         Next.js + Tailwind website, including the owner page /admin
deploy/          Production: compose file, Caddy, "back soon" page, deploy/backup/restore scripts
```
