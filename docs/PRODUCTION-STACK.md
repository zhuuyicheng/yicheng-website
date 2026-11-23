# The production stack (Phase 6b)

What runs on the server, and how to run exactly that on your laptop: the same images, the
same Caddy rules, the same two API replicas. Design:
[DESIGN.md §14.5](../DESIGN.md#145-hosting-oracle-cloud-free-tier-one-hostname). The images
themselves: [DOCKER.md](DOCKER.md).

---

## 1. The picture

```
            browser ── https://localhost (on the server: https://<name>.duckdns.org)
                                │ :80 → redirect, :443
                        ┌───────▼────────┐
                        │     caddy      │ HTTPS, routing by path, load balancing
                        └──┬─────────┬───┘
                 /api/*    │         │ everything else
                    ┌──────┴──┐      └──────────► web ──┐ the web server's own API calls go
                    ▼         ▼                          │ back through caddy:8080 (internal)
                  api-1     api-2  ◄─────────────────────┘
                    │         │          worker
                    └────┬────┴────────────┘
                   postgres + redis      (all shared state lives here)

   prometheus ── every 15 s ──► api-1, api-2, worker, node-exporter (the VM)   (monitoring)
```

Everything is in [`deploy/`](../deploy/):

| File                                                     | What                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`compose.prod.yml`](../deploy/compose.prod.yml)         | the nine services, their settings and health checks                               |
| [`prometheus/`](../deploy/prometheus/)                   | what Prometheus reads, and the check CI runs (DESIGN.md §15)                      |
| [`caddy/Caddyfile`](../deploy/caddy/Caddyfile)           | HTTPS, routing, load balancing                                                    |
| [`caddy/back-soon.html`](../deploy/caddy/back-soon.html) | what visitors see while the site is paused ([CD.md §5](CD.md#5-pausing-the-site)) |
| [`.env.example`](../deploy/.env.example)                 | template for `deploy/.env`: hostname and secrets                                  |
| [`failover-test.sh`](../deploy/failover-test.sh)         | the proof that load balancing works (section 6)                                   |
| [`deploy.sh`](../deploy/deploy.sh)                       | a release, rolled out one service at a time ([CD.md](CD.md))                      |

| Service                         | Image                | Reachable from your machine? | Health check                   |
| ------------------------------- | -------------------- | ---------------------------- | ------------------------------ |
| `caddy`                         | `caddy:2.11-alpine`  | **yes**: ports 80 and 443    | none                           |
| `api-1`, `api-2`                | `portfolio-api`      | no                           | `GET /health` every 30 s       |
| `worker`                        | `portfolio-api`      | no                           | none (only `/metrics`, 4001)   |
| `web`                           | `portfolio-web`      | no                           | `GET /icon.svg` every 30 s     |
| `postgres`, `redis`             | official images      | no                           | `pg_isready`, `redis-cli ping` |
| `prometheus`                    | `prom/prometheus`    | no                           | `promtool check ready`, 30 s   |
| `node-exporter`                 | `prom/node-exporter` | no                           | none (Prometheus reads it)     |
| `migrate`, `seed`, `replay-dlq` | `portfolio-api`      | no, run on demand            | (tools: they run and exit)     |

Only Caddy publishes ports. The database and Redis are reachable only by the other
containers, which is most of what keeps them safe on a server facing the internet.

It is a separate Compose project (`portfolio-prod`) with its own volumes: your dev datastores
(`npm run infra:up`) and dev servers keep running untouched next to it.

---

## 2. Settings: `deploy/.env`

Compose reads `deploy/.env` because it sits next to `compose.prod.yml`. Git ignores it.

```bash
cp deploy/.env.example deploy/.env
openssl rand -hex 32     # run once per secret, paste each into deploy/.env
```

Fill in `POSTGRES_PASSWORD`, `IP_HASH_SECRET`, `METRICS_TOKEN` and `ADMIN_TOKEN`. On your
laptop keep `SITE_HOST=localhost` and `NOTIFIER_DRIVER=log` (so trying the stack never posts
to your Discord channel). A missing value stops Compose with a message naming it.

(Phase 6b created a `deploy/.env` like this for you, with fresh random secrets. The server has
its own, with different secrets ([CD.md §2.2](CD.md#22-the-servers-settings-file)); keep a
copy of that one in your password manager.)

**Each container gets only what it needs.** The compose file passes variables one by one
instead of handing every container the whole file: the web server gets `API_BASE_URL`,
`API_REPLICA_URLS` (the `/admin` dashboard asks each API replica; not a secret, so it is
written in the compose file) and `ADMIN_TOKEN`, nothing else, so it never sees the database
password.

---

## 3. Start it

```bash
npm run image:api && npm run image:web    # build the images (DOCKER.md)
npm run stack:up                          # migrate → seed → start everything, wait for healthy
```

`stack:up` is the same order a deploy uses: migrations first (backward compatible, DESIGN.md
§14.4), then the content, then the services. `up --wait` returns once every health check
passes. Running it again is safe: no migration is applied twice, and the content is the same.

Open **https://localhost**. The browser warns that the connection is not private: Caddy made
the certificate itself (a real authority only certifies real domain names). Click
**Advanced → Proceed**. On the server, with your DuckDNS name, Caddy gets a real Let's Encrypt
certificate and there is no warning.

Then **https://localhost/admin**: any user name, password = `ADMIN_TOKEN` from `deploy/.env`.
At the bottom, "answered by" alternates between `api-1` and `api-2`.

```bash
npm run stack:down     # stop and remove the containers; the data volumes stay
```

**Deploying the way the server does** (Phase 6c): `npm run stack:deploy -- dev` runs the same
script as the deploy workflow on these images: migrate, seed, then a rolling update with a
smoke test, and a rollback if that fails. Any tag works: to try a "new release", run
`docker tag portfolio-api:dev portfolio-api:v2` (and the same for the web image), then
`npm run stack:deploy -- v2`. Details: [CD.md](CD.md).

---

## 4. How a request travels

- **A page** (`/`, `/portfolio-telemetry-platform`): Caddy → `web`. The web server fetches the
  content from `http://caddy:8080`, Caddy's internal listener, which balances those calls over
  the two replicas too.
- **The browser's own API calls** (page views, contact form): the web image was built with an
  empty `NEXT_PUBLIC_API_BASE_URL`, so they go to `/api/...` on the same address, and Caddy
  sends `/api/*` to `api-1` or `api-2` in turn (round robin).
- **Not reachable from outside**, by design: `/health` and `/metrics` (no `/api` prefix, so
  they land on the website: 404) and `/api/v1/admin/*`, which Caddy refuses even with the
  right token. Only the web server, through `:8080`, can call the owner's routes.

```bash
curl -k -o /dev/null -w '%{http_code}\n' https://localhost/api/v1/projects   # 200
curl -k -o /dev/null -w '%{http_code}\n' https://localhost/health            # 404
curl -k -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer <ADMIN_TOKEN>" \
  https://localhost/api/v1/admin/visitors                                    # 404
```

**The visitor's address.** Every request reaches the API from Caddy. Caddy puts the real
address in the `X-Forwarded-For` header (replacing any value the visitor sent, so it cannot be
faked), and `TRUST_PROXY=true` tells the API to read it. On your laptop every visit seems to
come from Docker's gateway (`172.x.0.1`); on the server it is the visitor's own address.

---

## 5. Three health checks, three questions

| Who asks           | Asks               | How often    | Answer used for                                    |
| ------------------ | ------------------ | ------------ | -------------------------------------------------- |
| Docker             | `GET /health`      | every 30 s   | "healthy" in `docker compose ps`; `up --wait`      |
| Caddy              | `GET /health/live` | every 5 s    | whether a replica gets requests                    |
| Caddy, per request | (connects)         | each request | a refused or slow connection → retry the other one |

- **Docker uses `/health` (readiness)**: "healthy" means Postgres and Redis answer, so a deploy
  waiting for it knows the new replica can really serve.
- **Caddy uses `/health/live` (liveness)**: if Redis goes down, `/health` fails on _both_
  replicas at once; Caddy would remove both and the whole site would go down, although pages
  could still be served from Postgres. A load balancer should only drop the one replica that
  is broken.
- **Retries** (`lb_try_duration 5s`) cover the seconds before Caddy's next check notices a
  replica is gone: a request that cannot connect is sent to the other replica instead.

Both health endpoints log nothing at `info` level, or the checks would fill the logs.

---

## 6. Prove it: failover

```bash
npm run stack:failover
```

While a background loop sends a request every 50 ms through Caddy, the script stops `api-1`,
starts it again, then replaces `api-1` and `api-2` with new containers one at a time, exactly
like a deploy. Then it counts:

```
Requests: 524, succeeded: 524, failed: 0, slowest: 1.292353 s
No request failed.
```

It exits with code 1 if any request failed. The slowest request is the price of a retry: about
a second, a few times per update.

### Two lessons this script taught (and the rules they became)

The first version failed one request in a few hundred. Each failure had a cause worth knowing:

1. **A removed container's name can take seconds to look up.** While a replica is being
   replaced, its old container is gone before Caddy's next check notices. Docker's DNS no
   longer knows the name and passes the question to your machine's DNS, which can hang. That
   request waited 6 s, longer than Caddy's 5 s of retries, and failed.
   **Rule:** `dial_timeout 1s` in the Caddyfile: connecting (lookup included) gives up after
   1 s, leaving time to retry on the other replica. That is the 1.29 s "slowest" above.
2. **"Healthy" for Docker is not "in use" for Caddy.** The rolling update replaced `api-2` the
   moment Docker called the new `api-1` healthy. But Caddy only re-admits a replica at its
   next 5-second check, so for a moment it had no replica at all (a `503`).
   **Rule:** after a replica is healthy, wait 6 s (one check interval plus a second) before
   taking the other one down. `deploy/deploy.sh` (6c) follows the same rule.

Also tested: 4,876 `POST /api/v1/events` sent during a failover run all succeeded. Caddy may
resend a request that never reached a replica; one that did is finished by the replica's
graceful shutdown before it exits.

---

## 7. Operating it

All from the repository root, with `C="docker compose -f deploy/compose.prod.yml"`:

```bash
$C ps                                  # what runs, and its health
$C logs -f api-1 caddy                 # follow logs (JSON); Ctrl+C to stop following
$C run --rm replay-dlq telemetry       # the CLIs: migrate, seed, replay-dlq <queue>
$C exec caddy caddy reload --config /etc/caddy/Caddyfile   # apply a Caddyfile change
$C exec prometheus promtool query instant http://localhost:9090 up   # who answers Prometheus
$C kill -s HUP prometheus             # apply a prometheus/prometheus.yml change
```

- **Logs are capped**: 3 files × 10 MB per container (Docker otherwise keeps them forever and a
  small server's disk fills up).
- **Changing the Caddyfile**: edit `deploy/caddy/Caddyfile`, then `reload`: no restart, no
  dropped requests. Compose mounts the `caddy/` _folder_, not the file: a mounted single file
  keeps showing the version from when the container started (editors and `git pull` replace
  files rather than rewrite them). While this was being built, that made a fix look tested
  when Caddy was still running the old rules.
- **Restarts**: every long-running service has `restart: unless-stopped`, so after a crash or
  a server reboot Docker starts it again.
- **Pausing**: `touch deploy/caddy/paused` and https://localhost shows the "back soon" page
  (`/admin` still works); `rm deploy/caddy/paused` brings the site back. No reload either way
  ([CD.md §5](CD.md#5-pausing-the-site)).
- **Data**: `stack:down` keeps the volumes (database, Redis, certificates).
  `docker compose -f deploy/compose.prod.yml down -v` deletes them: on the server that is the
  database, so never there. Keep `caddy-data` too: it holds the certificates, and Let's
  Encrypt issues the same one only 5 times a week.
- **Inside the datastores**: [DATA-TOOLS.md §7.6](DATA-TOOLS.md#76-phase-6b-the-production-stack-on-your-laptop).
- **Monitoring** (DESIGN.md §15): Prometheus reads every process's `/metrics` every 15 s and
  keeps 30 days in its own volume. `up` above prints `1` for each target that answers and `0`
  for one that doesn't (stopped, or a wrong `METRICS_TOKEN`). On Docker Desktop the VM's disk
  numbers are missing: its root disk is a type node-exporter skips (the server's is counted).

## 8. Troubleshooting

| Symptom                                     | Cause and fix                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `required variable … is missing a value`    | Fill it in `deploy/.env` (section 2)                                                 |
| `pull access denied for portfolio-api`      | The image is not built yet: `npm run image:api && npm run image:web`                 |
| `port is already allocated` / `bind: … 443` | Another program uses port 80 or 443: stop it (or the other container), then retry    |
| "Your connection is not private"            | Expected for `localhost`: Caddy's own certificate (section 3)                        |
| Site says "This page couldn't load"         | Both replicas down: `$C ps`, then `$C logs api-1`                                    |
| A Caddyfile change has no effect            | `reload` (section 7); check `$C exec caddy cat /etc/caddy/Caddyfile` shows your edit |
| `stack:failover` reports failures           | Read Caddy's reasons: `$C logs caddy \| grep '"level":"error"'`                      |
| Changed code does not show                  | Rebuild the image (`npm run image:api`), then `npm run stack:up` again               |

---

## Check yourself

1. Why does Caddy check `/health/live` while Docker checks `/health`?
2. In a rolling update, why wait 6 s after the new `api-1` is healthy before replacing `api-2`?
3. Why can nobody on the internet call `/api/v1/admin/visitors`, even with the token, while
   the `/admin` page still works?
4. Why does the compose file list each container's variables instead of giving every
   container `deploy/.env`?
5. What would happen to the visitor's IP address with `TRUST_PROXY=false`?

<details>
<summary>Answers</summary>

1. They answer different questions. Docker's answer decides "is this new replica ready?"
   (database and Redis reachable). Caddy's decides "should this replica get requests?"; if it
   used `/health`, a Redis outage would make both replicas fail at once and Caddy would take
   the whole site down instead of serving what still works.
2. Caddy only notices the new replica at its next health check, up to 5 s later. Replace
   `api-2` sooner and Caddy has no replica it trusts for a moment: requests fail with 503.
3. Caddy answers `/api/v1/admin/*` with 404 on the public site. The web server calls the API
   through Caddy's internal `:8080` listener, which has no such rule and is not published.
4. Least privilege: a container can only leak what it has. The web server never needs the
   database password or the IP-hash secret, so it never gets them.
5. Every request would seem to come from Caddy's own address: one "visitor" for the whole
   internet, so the rate limit would block everyone together and the IP lookups would find
   nothing.

</details>
