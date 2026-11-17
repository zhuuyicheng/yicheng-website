# Portfolio & Live Telemetry Platform

A personal portfolio backed by a production-style TypeScript backend: Redis cache-aside reads,
asynchronous event ingestion with a batch-flushing worker, a Lua sliding-window rate limiter,
background jobs with retries and dead-letter queues, and live observability.

- **Design**: [DESIGN.md](DESIGN.md)
- **Progress**: [ROADMAP.md](ROADMAP.md)
- **Guides**: [Testing](docs/TESTING.md) · [CI](docs/CI.md) · [Content & cache](docs/CONTENT-AND-CACHE.md) ·
  [Seeing the data in VS Code](docs/DATA-TOOLS.md)

## Quick start

Requires Node 24 (via [nvm](https://github.com/nvm-sh/nvm)) and Docker.

```bash
nvm use                  # Node 24 from .nvmrc
npm install
cp .env.example .env
npm run infra:up         # Postgres 16 + Redis 7 in Docker
npm run db:migrate       # create the tables
npm run content:seed     # load apps/api/content/portfolio.json

npm run dev:api          # API  → http://localhost:4000/api/v1/projects
npm run dev:web          # Web  → http://localhost:3000   (in a second terminal)
```

## Common commands

| Command                | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `npm test`             | Unit + integration tests (needs `infra:up`)        |
| `npm run test:unit`    | Unit tests only (no Docker needed)                 |
| `npm run check`        | Everything CI runs: format, lint, typecheck, tests |
| `npm run content:seed` | Publish edits to `apps/api/content/portfolio.json` |
| `npm run infra:down`   | Stop the Docker datastores (data is kept)          |

## Working on another machine

Everything needed to rebuild the project lives in Git. Your local database contents do not,
and don't need to: tables come from migrations and content from `portfolio.json`.

1. **On the old machine**, push your branch: `git push` (check with `git status` that nothing
   is left uncommitted).
2. **On the new machine**, install Git, Docker, and nvm + Node 24, then:

   ```bash
   git clone https://github.com/zhuuyicheng/yicheng-website.git
   cd yicheng-website
   git switch <your-branch>       # e.g. feat/portfolio-cache-api
   nvm install                    # installs the Node version in .nvmrc
   npm ci
   cp .env.example .env           # .env is never committed
   npm run infra:up && npm run db:migrate && npm run content:seed
   npm run check                  # confirms the new machine is set up correctly
   ```

## Repository layout

```
apps/api   Fastify API (MVC: routes → controllers → services → repositories, views)
apps/web   Next.js + Tailwind frontend
```
