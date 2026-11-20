# Running Tests Locally

This guide walks through running, filtering, debugging and writing tests. All commands run
from the **repository root** unless stated otherwise.

---

## 1. One-time setup

```bash
nvm use                      # switch to Node 24 (reads .nvmrc); Vitest 5 needs Node ≥ 22.12
npm install                  # install all workspaces
cp .env.example .env         # only if you don't have a .env yet
npm run infra:up             # start Postgres + Redis in Docker and wait until healthy
```

Check the containers are healthy:

```bash
docker compose ps
# NAME                   STATUS
# portfolio-postgres-1   Up 2 minutes (healthy)
# portfolio-redis-1      Up 2 minutes (healthy)
```

> `nvm use` only affects the current terminal. Run it in every new terminal, or make Node 24
> your default with `nvm alias default 24`.

---

## 2. The kinds of tests

|                | Unit tests                                                                          | Integration tests                            |
| -------------- | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| Folder         | `apps/api/test/unit/` (mirrors `src/`)                                              | `apps/api/test/integration/`                 |
| What they test | One piece of logic in isolation (config parsing, error mapping, shutdown ordering…) | Real behaviour against real Postgres + Redis |
| Needs Docker?  | **No**                                                                              | **Yes** (`npm run infra:up`)                 |
| Speed          | Milliseconds, run in parallel                                                       | Slower, run one file at a time               |
| Fakes          | Uses fakes/stubs (e.g. a fake `ping` that always fails)                             | Uses the real datastores                     |

The **website** has unit tests too, in `apps/web/test/lib/` (mirroring `apps/web/src/lib/`):
the logic behind the page-view beacon, the contact form, the project pages and the
dashboard, tested without a browser or React. `npm test` and `npm run test:unit` run them
after the API's. Every test command first builds `packages/shared` (the API contract both
apps import), so its compiled `dist/` is always current.

**Integration tests never touch your development data.** They use:

- a separate database, `portfolio_test` (created automatically on the first run),
- Redis logical database `1` (development uses database `0`).

Before integration tests run, `test/integration/global-setup.ts` checks that Docker is
reachable, creates `portfolio_test` if needed, and applies all migrations to it.

Three techniques worth knowing when you read the tests:

- **Real processes.** Some integration tests start an entrypoint exactly as `npm run` would
  (`node --import tsx src/…`) and talk to it the way the outside world does: HTTP, signals
  (`SIGTERM`), exit codes and its JSON log lines. `api-process.test.ts` and
  `worker-process.test.ts` cover graceful shutdown; `seed-content.test.ts` and
  `replay-dlq.test.ts` cover the CLIs.
- **Injected time.** Code that waits (the worker's flush loop) or reads the clock (the daily
  salt) takes `sleep` / `now` as optional dependencies. Unit tests pass fakes, so "back off for
  30 seconds" is checked instantly: see `test/unit/workers/telemetry-flusher.worker.test.ts`.
- **Fixture files.** `test/fixtures/geoip/` holds MaxMind's tiny public test databases, so the
  IP lookup is tested with real `.mmdb` files without downloading the production ones. The IP
  addresses they know are listed in `test/helpers/geoip-fixtures.ts`.

---

## 3. Everyday commands

| Goal                                          | Command                                                               |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Run **everything**                            | `npm test`                                                            |
| Unit tests only (no Docker needed)            | `npm run test:unit`                                                   |
| Integration tests only                        | `npm run test:integration`                                            |
| Re-run unit tests on every save (watch mode)  | `npm run test:watch -w @portfolio/api` (web: `-w @portfolio/web`)     |
| One file                                      | `npm run test -w @portfolio/api -- test/unit/config/env.test.ts`      |
| One web file                                  | `npm run test -w @portfolio/web -- test/lib/contact.test.ts`          |
| Tests whose name matches some text            | `npm run test -w @portfolio/api -- -t "request id"`                   |
| What CI runs (format, lint, typecheck, tests) | `npm run check` (CI then also runs `npm run build -w @portfolio/web`) |

Why the `-w @portfolio/api --` part? `-w` tells npm which workspace to run the script in,
and everything after `--` is passed straight through to Vitest.

---

## 4. Reading the output

A passing run ends like this:

```
 ✓  unit  test/unit/config/env.test.ts (17 tests) 20ms
 ✓  integration  test/integration/health.test.ts (9 tests) 122ms
 ...
 Test Files  45 passed (45)
      Tests  305 passed (305)
 ...
 ✓ test/lib/contact.test.ts (11 tests) 36ms
 Test Files  10 passed (10)
      Tests  74 passed (74)
```

The first block is the API: the coloured `unit` or `integration` label says which Vitest
project a file belongs to (configured in `apps/api/vitest.config.ts`). The second block is the
website. (Counts as of 2026-11-20; they grow with every feature.)

A failing test prints the test name, the assertion that failed, and the expected vs received
values with the exact file and line:

```
 FAIL   unit  test/unit/config/env.test.ts > loadConfig > applies defaults
AssertionError: expected 4000 to be 8080
 ❯ test/unit/config/env.test.ts:23:31
```

Click the file path in VS Code to jump to it.

---

## 5. Looking at the test data yourself

```bash
# Postgres: open a SQL shell on the test database
docker compose exec postgres psql -U portfolio -d portfolio_test
portfolio_test=# \dt                               -- list tables
portfolio_test=# SELECT * FROM schema_migrations;  -- which migrations are applied
portfolio_test=# \q                                -- quit

# Redis: open a shell on the test database (1)
docker compose exec redis redis-cli -n 1
127.0.0.1:6379[1]> KEYS *
127.0.0.1:6379[1]> exit
```

Swap `portfolio_test` → `portfolio` and `-n 1` → `-n 0` to look at development data instead.

Prefer clicking to typing? The VS Code PostgreSQL and Redis extensions show the same data as
tables and key trees: see [DATA-TOOLS.md](DATA-TOOLS.md) (Postgres connection
`portfolio (tests)`; the Redis extension only shows DB 0, so use `redis-cli -n 1` for test keys).

---

## 6. Troubleshooting

| Symptom                                                            | Cause                                         | Fix                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot connect to Postgres at localhost:5432. Is Docker running?` | Containers not started                        | `npm run infra:up` (start Docker Desktop first if needed)                                                                                                                                             |
| `Vitest requires Node.js ^22.12.0 …` or odd syntax errors          | Wrong Node version in this terminal           | `nvm use`                                                                                                                                                                                             |
| Port 5432 / 6379 already in use                                    | Another Postgres/Redis on your machine        | Change `POSTGRES_PORT`/`REDIS_PORT` in `.env`, then run tests with `TEST_DATABASE_URL=postgres://portfolio:portfolio@localhost:<port>/portfolio_test` and `TEST_REDIS_URL=redis://localhost:<port>/1` |
| A test hangs and times out                                         | Usually an awaited promise that never settles | Run just that file; look for a missing `await` or an unclosed client in `afterAll`                                                                                                                    |
| You want a completely clean slate                                  | Old data in the Docker volumes                | `docker compose down -v && npm run infra:up` (**deletes all local data**)                                                                                                                             |

---

## 7. Writing a new test

**Unit test**: place it in the folder matching the source file
(`src/services/foo.manager.ts` → `test/unit/services/foo.manager.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { slugify } from '../../../src/services/foo.manager.js';

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
});
```

**Integration test**: use the shared helpers to get real, connected clients and a full app,
then send in-memory HTTP requests with `app.inject()` (no network port needed):

```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';

let deps: TestDependencies;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  deps = await createTestDependencies();
  app = buildApp(deps);
});

afterAll(async () => {
  await app.close();
  await deps.close(); // always close clients, or Vitest will hang
});

it('GET /health returns 200', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  expect(response.statusCode).toBe(200);
});
```

**Web test**: logic goes in `apps/web/src/lib/` (no React, browser objects passed in as
arguments, like `fetch` or `sessionStorage`), and its test in `apps/web/test/lib/`, importing
with the `@/` alias (`import { formatWait } from '@/lib/contact'`).

Conventions: one behaviour per `it(...)`, names that read as sentences, arrange → act →
assert separated by blank lines.
