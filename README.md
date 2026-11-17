# Portfolio & Live Telemetry Platform

A personal portfolio backed by a production-style TypeScript backend: Redis cache-aside reads,
asynchronous event ingestion with a batch-flushing worker, a Lua sliding-window rate limiter,
background jobs with retries and dead-letter queues, and live observability.

- **Design**: [DESIGN.md](DESIGN.md)
- **Progress**: [ROADMAP.md](ROADMAP.md)
- **Guides**: [Testing](docs/TESTING.md) · [CI](docs/CI.md)

## Quick start

Requires Node 24 (via [nvm](https://github.com/nvm-sh/nvm)) and Docker.

```bash
nvm use                  # Node 24 from .nvmrc
npm install
cp .env.example .env
npm run infra:up         # Postgres 16 + Redis 7 in Docker
npm run db:migrate

npm run dev:api          # API  → http://localhost:4000/health
npm run dev:web          # Web  → http://localhost:3000   (in a second terminal)
```

## Common commands

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm test`           | Unit + integration tests (needs `infra:up`)        |
| `npm run test:unit`  | Unit tests only (no Docker needed)                 |
| `npm run check`      | Everything CI runs: format, lint, typecheck, tests |
| `npm run infra:down` | Stop the Docker datastores (data is kept)          |

## Repository layout

```
apps/api   Fastify API (MVC: routes → controllers → services → repositories, views)
apps/web   Next.js + Tailwind frontend
```
