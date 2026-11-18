# Portfolio & Live Telemetry Platform

A personal portfolio backed by a production-style TypeScript backend: Redis cache-aside reads,
asynchronous event ingestion with a batch-flushing worker, a Lua sliding-window rate limiter,
background jobs with retries and dead-letter queues, and live observability.

- **Design**: [DESIGN.md](DESIGN.md)
- **Progress**: [ROADMAP.md](ROADMAP.md)
- **New here? Start with the hands-on [Guided Tour](docs/GUIDED-TOUR.md)**
- **Guides**: [Editing the site's text](docs/EDITING-THE-SITE.md) · [Testing](docs/TESTING.md) · [CI](docs/CI.md) · [Content & cache](docs/CONTENT-AND-CACHE.md) ·
  [Seeing the data in VS Code](docs/DATA-TOOLS.md) · [Hosting (server setup)](docs/HOSTING.md)

## Quick start

Requires Node 24 (via [nvm](https://github.com/nvm-sh/nvm)) and Docker.

```bash
nvm use                  # Node 24 from .nvmrc
npm install
cp .env.example .env
npm run infra:up         # Postgres 16 + Redis 7 in Docker
npm run db:migrate       # create the tables
npm run content:seed     # load apps/api/content/portfolio.json
npm run geoip:download   # free IP → organisation/location files (~65 MB download)

npm run dev:api          # API    → http://localhost:4000/api/v1/projects
npm run dev:worker       # Worker → analytics events to Postgres, contact notifications
npm run dev:web          # Web    → http://localhost:3000 (owner dashboard: /admin); each in its own terminal
```

## Common commands

| Command                               | What it does                                         |
| ------------------------------------- | ---------------------------------------------------- |
| `npm test`                            | Unit + integration tests (needs `infra:up`)          |
| `npm run test:unit`                   | Unit tests only (no Docker needed)                   |
| `npm run check`                       | Format, lint, typecheck, tests (CI also builds site) |
| `npm run content:seed`                | Publish edits to `apps/api/content/portfolio.json`   |
| `npm run dlq:replay -- telemetry`     | Retry dead-lettered analytics events after a fix     |
| `npm run dlq:replay -- notifications` | Retry failed contact notifications after a fix       |
| `npm run geoip:download`              | Refresh the IP databases (monthly), then restart API |
| `npm run infra:down`                  | Stop the Docker datastores (data is kept)            |

## Working on another machine

Everything needed to rebuild the project lives in Git. Your local database contents do not,
and don't need to: tables come from migrations and content from `portfolio.json`.

1. **On the old machine**, push your branch: `git push` (check with `git status` that nothing
   is left uncommitted).
2. **On the new machine**, install Git, Docker, and nvm + Node 24, then:

   ```bash
   git clone https://github.com/zhuuyicheng/yicheng-website.git
   cd yicheng-website
   git switch <your-branch>       # main, or the phase branch you were working on
   nvm install                    # installs the Node version in .nvmrc
   npm ci
   cp .env.example .env           # .env is never committed
   npm run infra:up && npm run db:migrate && npm run content:seed
   npm run geoip:download         # the IP databases are downloaded, not committed
   npm run check                  # confirms the new machine is set up correctly
   ```

## Repository layout

```
packages/shared  The API contract: Zod schemas both apps import
apps/api         Fastify API (controllers → managers → DAL, with dao/, schema/, views/) and the
                 background worker (src/worker.ts, workers/)
apps/web         Next.js + Tailwind website (portfolio pages, contact form, page-view beacon)
```
