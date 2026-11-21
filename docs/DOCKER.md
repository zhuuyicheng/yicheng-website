# Docker images (Phase 6a)

How the API and the website are packaged for the server, how to build and run the images on
your laptop, and how CI checks them. Design: [DESIGN.md §14.2](../DESIGN.md#142-artifacts).

---

## 1. Why images

On the server nothing is installed but Docker. Everything else (Node, the compiled code, the
right `node_modules`, the GeoIP files) travels inside an **image**: a frozen, read-only
filesystem plus the command to start. A **container** is one running copy of an image.

The point is that the thing you tested is exactly the thing that runs: CI builds the image
once, and the server runs that same image, byte for byte. No `npm install` on the server, no
"works on my machine".

There are two images:

| Image           | Dockerfile                                      | Runs                                                            |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `portfolio-api` | [`apps/api/Dockerfile`](../apps/api/Dockerfile) | the API, **and** the worker, migrations, seeding and DLQ replay |
| `portfolio-web` | [`apps/web/Dockerfile`](../apps/web/Dockerfile) | the website (Next.js standalone server)                         |

One API image for five jobs because they share all their code; only the command differs:

```bash
node dist/main.js                    # the API (the image's default command)
node dist/worker.js                  # the background worker
node dist/cli/migrate.js             # apply migrations (once per release)
node dist/cli/seed-content.js        # publish content/portfolio.json
node dist/cli/replay-dlq.js telemetry
```

---

## 2. Build them

From the repository root, with Docker running:

```bash
npm run image:api    # → portfolio-api:dev   (first time ~1.5 min, mostly downloads)
npm run image:web    # → portfolio-web:dev   (~1.5 min)
docker image ls portfolio-*
```

A second build after a code change takes seconds, thanks to the layer cache (section 3).

Both builds use the **repository root** as their "build context" (the final `.`), because both
apps need `packages/shared`. [`.dockerignore`](../.dockerignore) keeps the rest out: your
`node_modules` (built for your laptop, not the image), build output, the `.env` file (secrets
never go into an image) and docs.

---

## 3. Reading the API Dockerfile

It is a **multi-stage** build: several temporary images, each doing one job, and a final one
that copies only the results. Compilers and test tools stay behind in the temporary stages.

```
base ─┬─ deps ─┬─ build ──────── compile packages/shared and the API (tsc → dist/)
      │        └─ geoip ──────── download this month's DB-IP files
      ├─ prod-deps ───────────── npm ci --omit=dev (runtime packages only)
      └─ runtime ◄── copies dist/, node_modules, migrations/, content/, data/geoip/
```

Things worth noticing, top to bottom:

1. **`node:24-trixie-slim`**: Node on a slim Debian. Debian uses glibc, which the prebuilt
   native packages (sharp, Tailwind's compiler) are built for. Alpine is smaller but uses
   musl, a classic source of odd failures.
2. **Package files first, source later.** Docker caches each step and reuses it until its
   inputs change. `npm ci` only depends on the `package.json` files and the lockfile, so it
   is copied and run _before_ the source: editing a `.ts` file reuses the installed packages
   and only recompiles. Copy the source first and every edit would reinstall everything.
3. **`npm ci --ignore-scripts`**: the repository's own `postinstall` builds `packages/shared`,
   but its source is not in the image yet at that point; the build stage builds it instead.
   No runtime package needs an install script.
4. **The `geoip` stage** copies only the downloader and the two modules it imports, and runs
   them with `tsx`. So the download (~140 MB of files) depends on those three files and the
   month, not on the rest of the code: rebuilding after a code change reuses it. `GEOIP_MONTH`
   is the cache key: `npm run image:api` and CI pass the current month, so a new month fetches
   fresh files. If you add an import to `download-geoip.ts`, add that file to this stage too
   (the build fails with "Cannot find module" if you forget).
5. **`runtime`**: files belong to `root` and the process runs as the unprivileged `node`
   user (`USER node`), so even a compromised process cannot change its own code.
   `NODE_OPTIONS=--enable-source-maps` makes stack traces point at the `.ts` lines.
6. **No `HEALTHCHECK`** in the image: the worker and the CLIs use it too, and they serve no
   HTTP. Compose checks the API service instead (Phase 6b).
7. **No init process.** Node runs as PID 1 and handles `SIGTERM` itself (graceful shutdown),
   so `docker stop` lets in-flight requests finish.

## 4. Reading the web Dockerfile

Same pattern, two differences:

- **Standalone output.** `output: 'standalone'` in
  [`next.config.ts`](../apps/web/next.config.ts) makes `next build` also write
  `.next/standalone/`: a small `server.js` plus only the `node_modules` files the pages use.
  The image copies that and `.next/static` (JavaScript, CSS, photos). Locally, `next start`
  now prints a warning that it "does not work with output: standalone": ignore it, it still
  serves the site; the image uses `server.js`.
- **`NEXT_PUBLIC_API_BASE_URL` is empty at build time.** Next.js copies it into the browser's
  JavaScript during the build. Empty means browsers call `/api/v1/...` on the page's own
  address, and Caddy (6b) sends those to the API. So the image contains no hostname and works
  under DuckDNS, is-a.dev or anything else. `API_BASE_URL` (where the _server_ fetches
  content) and `ADMIN_TOKEN` are ordinary run-time variables.

The only writable folder is `.next/cache`, where Next.js keeps resized photos.

---

## 5. Run them on your laptop

Start the datastores as usual (`npm run infra:up`). The containers join the compose network
(`portfolio_default`), where Postgres and Redis are reachable by their service names. Ports
4100 and 3100 avoid clashing with your dev servers on 4000 and 3000.

```bash
# The API, reading your .env but with container addresses and production mode.
# NOTIFIER_DRIVER=log: never let a test container post to your real Discord channel.
docker run -d --name portfolio-api-dev --network portfolio_default \
  --env-file .env -e NODE_ENV=production -e NOTIFIER_DRIVER=log \
  -e DATABASE_URL=postgres://portfolio:portfolio@postgres:5432/portfolio \
  -e REDIS_URL=redis://redis:6379/0 \
  -p 4100:4000 portfolio-api:dev

# The website, fetching content from that container.
docker run -d --name portfolio-web-dev --network portfolio_default \
  --env-file .env -e NODE_ENV=production \
  -e API_BASE_URL=http://portfolio-api-dev:4000 \
  -p 3100:3000 portfolio-web:dev

curl http://localhost:4100/health/live     # {"status":"ok"}
curl http://localhost:4100/health          # both dependencies up
```

Open http://localhost:3100: the site, served entirely from the images. One expected gap:
page views and the contact form call `/api/...` on the page's own address (`localhost:3100`),
and the web server does not serve those paths, so they get a 404. In production Caddy sends
them to the API: [PRODUCTION-STACK.md](PRODUCTION-STACK.md) runs that whole setup on your
laptop.

Use the database user and password from your `.env` if you changed them. Watch the logs and
stop everything when done:

```bash
docker logs -f portfolio-api-dev           # JSON logs, one line per event (Ctrl+C to leave)
docker stop portfolio-api-dev portfolio-web-dev   # SIGTERM: watch "shutdown complete"
docker rm portfolio-api-dev portfolio-web-dev
```

**Do not start the worker image while your dev worker (`npm run dev:worker`) runs.** Two
workers would share the same queues, which the design rules out (DESIGN.md §8.4). To try it,
stop your dev worker first, or point the container at the test datastores (database
`portfolio_test`, Redis DB `1`).

The CLIs run the same way, with `--rm` because they exit when done:

```bash
docker run --rm --network portfolio_default --env-file .env \
  -e NODE_ENV=production -e DATABASE_URL=postgres://portfolio:portfolio@postgres:5432/portfolio \
  -e REDIS_URL=redis://redis:6379/0 portfolio-api:dev node dist/cli/migrate.js
```

## 6. Look inside an image

```bash
docker run --rm -it --entrypoint sh portfolio-api:dev    # a shell in a throwaway container
#   id            → uid=1000(node): not root
#   ls            → dist  content  data  migrations  node_modules  package.json
#   du -sh data/geoip node_modules
docker history portfolio-api:dev                         # each layer and its size
```

The API image adds ~170 MB to Node's base image: ~137 MB of GeoIP data and ~34 MB of
production packages. `docker image ls` shows a larger number because it counts both the
compressed and the unpacked copy.

---

## 7. What CI does

The `images` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) builds both
images on every PR and every push to `main`, next to the usual `check` job:

- On `ubuntu-24.04-arm`: GitHub's Arm machines, free for public repositories. The server is
  Arm (Oracle A1), so the images are built natively for `linux/arm64`, the same CPU type that
  runs them. Your laptop builds for its own CPU (amd64), which is fine for trying things.
- Nothing is pushed by this job. On `main`, the Deploy workflow's `publish` job (6c) rebuilds
  each image from these cached layers and pushes it to GitHub's container registry as
  `ghcr.io/<owner>/portfolio-<api|web>:<commit sha>` ([CD.md](CD.md)).
- Layers are cached in GitHub's Actions cache, one scope per image, so a PR that only changes
  the website does not rebuild the API from scratch, and the GeoIP files are downloaded once
  a month.

A broken Dockerfile now fails the PR (job `image (api)` or `image (web)`) instead of the deploy.
Both jobs are required checks for `main` ([CI.md §4](CI.md#4-protecting-main)).

## 8. Troubleshooting

| Symptom                                      | Cause and fix                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `network portfolio_default not found`        | The datastores are not running: `npm run infra:up`                                   |
| `port is already allocated`                  | Another container uses 4100/3100: `docker ps`, then `docker rm -f <name>`            |
| `Cannot find module` in the `geoip` stage    | `download-geoip.ts` imports a new file: add it to the stage's `COPY` lines           |
| GeoIP download fails                         | DB-IP unreachable or not yet published: retry later (it tries last month's file too) |
| API exits with a config error                | A required variable is missing: the message names it (`.env.example` lists them all) |
| `Cannot find module 'pino-pretty'`           | `NODE_ENV` is `development` (from your `.env`): add `-e NODE_ENV=production`         |
| Site shows "This page couldn't load"         | `API_BASE_URL` must name the API container: `http://portfolio-api-dev:4000`          |
| `--network host` works on Linux but not here | Docker Desktop's "host" is its own VM, not WSL: use the compose network as above     |

---

## Check yourself

1. Why does the Dockerfile copy the `package.json` files and run `npm ci` _before_ copying
   the source code?
2. You change one line in `content.manager.ts` and rebuild. Which stages run again, and does
   the GeoIP download happen?
3. Why is the web image built with an empty `NEXT_PUBLIC_API_BASE_URL`, and why can that not
   be changed with `docker run -e` later?
4. Why does the API image have no `HEALTHCHECK`?
5. Why must the load balancer call `/health/live` instead of `/health`?

<details>
<summary>Answers</summary>

1. Docker reuses a step's cached result until its inputs change. The packages depend only on
   the package files and the lockfile, so installing them first means a code change reuses
   the installed packages instead of reinstalling everything.
2. `build` (recompile) and `runtime` (copy the new `dist/`). `deps`, `prod-deps` and `geoip`
   are reused: none of their inputs changed, so nothing is downloaded.
3. Empty makes browsers call `/api/...` on the page's own address, so one image works under
   any hostname. `NEXT_PUBLIC_*` values are written into the JavaScript files during
   `next build`; by the time the container runs, they are fixed text in those files.
4. The worker and the CLIs use the same image and serve no HTTP, so an image-wide check would
   mark them unhealthy. The API service gets its check in compose (6b).
5. `/health` answers 503 when Postgres or Redis is down, on every replica at once. Caddy would
   remove them all and the site would be fully down, although content could still be served.
   `/health/live` only says "this process can answer" (DESIGN.md §14.5, tested in
   `test/integration/health.test.ts`).

</details>
