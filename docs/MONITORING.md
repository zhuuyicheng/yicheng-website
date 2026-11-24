# Monitoring (Phase 7)

Prometheus reads every part of the site every 15 seconds and keeps 30 days of numbers. When
something breaks, a message reaches the Discord channel your contact messages use. Grafana draws
the history at `https://<host>/grafana`, and `/admin` reads its system numbers from the same
place. Design: [DESIGN.md §15](../DESIGN.md#15-monitoring-prometheus-alertmanager-grafana-phase-7).

**Status**: live since 2026-11-24. On the server the whole stack uses about 1.22 GB of 5.76 GB,
the monitoring about 620 MB of it (Grafana 561 MB).

```
                   every 15 s: GET /metrics
   prometheus ───────────────────────► api-1, api-2, worker, node-exporter (the server itself)
     │ 30 days
     ├── alert rules ──► alertmanager ──► Discord ("Firing: …", "Resolved: …")
     ├──◄ grafana ◄── https://<host>/grafana (its own login)
     └──◄ /admin's tiles and charts
```

On the server, the commands below use the shortcut from
[PRODUCTION-STACK.md §7](PRODUCTION-STACK.md#7-operating-it):

```bash
C="docker compose -f $HOME/portfolio/deploy/compose.prod.yml"   # on your computer: deploy/compose.prod.yml
```

---

## 1. Where to look

| You want to…                                | Look at                                               |
| ------------------------------------------- | ----------------------------------------------------- |
| Know right now whether everything works     | `/admin`, the system status at the bottom             |
| See who visited                             | `/admin` (Grafana has no visitor details, on purpose) |
| See how a number changed over hours or days | Grafana, the "Portfolio" dashboard                    |
| Be told when something breaks               | Nothing: Discord tells you (section 3)                |
| Ask Prometheus something it doesn't show    | Grafana → **Explore**, or the terminal (section 4)    |

---

## 2. Grafana

**Logging in**: `https://<host>/grafana` (on your computer's stack, https://localhost/grafana),
user `admin`, password `GRAFANA_ADMIN_PASSWORD` from `deploy/.env` (keep it in your password
manager too). Five wrong passwords lock the account for about 5 minutes, even for the right one.

**The "Portfolio" dashboard** opens after login. Each panel's **(i)** says what it shows and
which alert watches it. From top to bottom:

1. **Right now**: requests, errors and p95 latency over the last 5 minutes, the cache hit ratio
   over 24 hours, alerts firing, and how old the last backup is.
2. **Visitor requests**: per replica (the two lines should run close together), by status
   (2xx fine, 4xx refused, 5xx failed), p50/p95/p99, and p95 per endpoint.
3. **Content cache, queues and the worker**: hits and misses, every Redis list, visits received
   by the API against visits saved by the worker (the lines should match), worker failures.
4. **Processes**: who answers Prometheus (green up, red down), memory and event-loop delay per
   process.
5. **The server**: CPU, memory and free disk of the VM.
6. **Alerts firing now**, as a table.

The time picker (top right) shows any stretch of the last 30 days; drag across a graph to zoom.
Health checks, Prometheus and `/admin` are left out of the request numbers, so they count
visitors only.

**Explore** (the compass in the left menu) runs any PromQL; a few to try are in section 4.

**Changing the dashboard**: Grafana won't save it, because it comes from Git. Change it in the
browser, then **Share → Export**, copy the JSON over `deploy/grafana/dashboards/portfolio.json`,
run `npm run monitoring:check`, commit and deploy. Grafana reloads the file within 30 seconds.

**A new password**: put it in `deploy/.env` (and your password manager), then hand it over from
there, so it never lands in your shell history:

```bash
$C exec grafana grafana cli admin reset-admin-password "$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' ~/portfolio/deploy/.env)"
```

(Grafana reads `GRAFANA_ADMIN_PASSWORD` only on its very first start, which is why changing the
file alone does nothing.)

---

## 3. Alerts

**How an alert travels.** Every 15 seconds Prometheus checks the rules in
[`deploy/prometheus/alerts.yml`](../deploy/prometheus/alerts.yml). A rule that stays true for
its waiting time (longer than a deploy's restarts, so releases stay quiet) fires; Alertmanager
waits 30 seconds for others of the same kind, then posts one message: **Firing: TargetDown**
(red), one line per instance, then what to do. While it keeps firing, it repeats twice a day.
When it clears: **Resolved: TargetDown** (green).

`$C` in a message is the shortcut above. Your computers' stacks never post: with
`NOTIFIER_DRIVER=log`, Alertmanager uses `log.yml` and only keeps the alerts.

| Alert            | Means                                                           | First step                                                                                    |
| ---------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `TargetDown`     | A process hasn't answered Prometheus for 2 minutes              | `$C ps`, then `$C logs <name>`; for api-1/api-2 the site still works through the other        |
| `ApiErrors`      | Over 5 % of visitor requests failed (5xx) for 10 minutes        | `$C logs api-1 api-2 \| grep 'request failed'`: each one with its cause                       |
| `ApiSlow`        | p95 over 0.5 s for 10 minutes                                   | `/admin`'s dependencies (a slow database?), `docker stats --no-stream` (a busy server?)       |
| `DeadLetters`    | Something failed for good and waits in a dead-letter list       | `/admin` → the queue → **Show items** says why; fix it, then `$C run --rm replay-dlq <queue>` |
| `TelemetryStuck` | Visits wait in Redis and the worker saved none for 20 minutes   | `$C logs worker`: it runs but cannot write to Postgres                                        |
| `WorkerFailing`  | The worker's loops failed 3+ times in 10 minutes, for 5 minutes | `$C logs worker`: usually Postgres or Redis not answering                                     |
| `DiskFilling`    | Under 20 % of the server's disk is free                         | `docker system df` (images, logs), `du -sh ~/backups`                                         |
| `MemoryHigh`     | Over 85 % of the server's memory is used, for 10 minutes        | `docker stats --no-stream`: which container                                                   |
| `BackupStale`    | No backup has succeeded for 8 days                              | [BACKUPS.md §5](BACKUPS.md#5-when-something-goes-wrong): is the cron line there?              |

**Silencing**, e.g. before planned work that will stop something (it still fires, but nothing
is posted until the silence ends):

```bash
AM="$C exec alertmanager amtool --alertmanager.url=http://localhost:9093"
$AM silence add alertname=TargetDown --duration=2h --comment="planned work"   # prints its id
$AM silence query                                                             # the active ones
$AM silence expire <id>                                                       # end one early
$AM alert query                                                               # what fires now
```

**A test message**, to see one arrive in Discord (it resolves by itself within 5 minutes):

```bash
$AM alert add alertname=TestAlert \
  --annotation='summary="A test from the server: alerts reach Discord."' \
  --annotation='description="Nothing to do: it resolves by itself within 5 minutes."'
```

**Changing a rule** (a threshold, a waiting time): edit `deploy/prometheus/alerts.yml` and its
cases in `alerts.test.yml`, run `npm run monitoring:check` (it runs every rule against made-up
data), commit and deploy. The deploy checks the files before changing anything and reloads
Prometheus afterwards.

---

## 4. Prometheus

It keeps 30 days, or less if its data reaches 2 GB first, in the Docker volume
`portfolio-prod_prometheus-data`. That data is not backed up: losing old graphs costs nothing,
and its configuration is in Git.

**Ask it from the terminal** (nothing about it is reachable from the internet):

```bash
$C exec prometheus promtool query instant http://localhost:9090 'up'
```

| PromQL                                                                  | Answers                                      |
| ----------------------------------------------------------------------- | -------------------------------------------- |
| `up`                                                                    | Who answered the last reading (1) or not (0) |
| `sum by (instance) (rate(http_requests_total{job="api"}[5m]))`          | Requests per second, per replica             |
| `sum(increase(http_requests_total{job="api", status_code=~"5.."}[1h]))` | Failed requests in the last hour             |
| `max by (queue) (queue_depth)`                                          | What waits in each Redis list                |
| `time() - max(portfolio_backup_last_success_timestamp_seconds)`         | Seconds since the last good backup           |

`rate()` and `increase()` work out growth from readings 15 seconds apart, so their answers are
estimates: a few requests made just before a restart aren't counted.

**In development**, `npm run infra:up` starts a Prometheus at http://localhost:9090 that reads
`dev:api` and `dev:worker`. Its **Alerts** page runs the same rules (`TargetDown` there just
means one of them isn't running); nothing is sent.

---

## 5. Switching it on (the Phase 7 deploy, once)

1. **Before merging**, add the new setting to the server's `deploy/.env`, and to your password
   manager:

   ```bash
   ssh portfolio
   echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 24)" >> ~/portfolio/deploy/.env
   ```

   Without it the deploy stops at its first check, naming the setting, and changes nothing.

2. **Merge and approve** as usual ([CD.md §3](CD.md#3-releasing)). New lines in the log: the
   pinned images being pulled (Grafana's is about 1.9 GB, a few minutes, once), the monitoring
   files checked, and at the end a `monitoring:` step that reloads them and reports each part.
3. **Look**: log into `https://<host>/grafana`; `/admin`'s bottom line lists
   `api-1 ●, api-2 ●, node-exporter ●, worker ●`.
4. **Give the backup alert its starting point**: `bash ~/portfolio/deploy/backup.sh` once (or
   wait for Sunday). Until a backup records its time, "Last backup" shows "—".
5. **If you like, the test message** from section 3.
6. **Reload `/admin`** if it was open during the deploy: the old page can't read the new answer.
7. **Memory**: `docker stats --no-stream`, then note the total in ROADMAP.md (Phase 7).

---

## 6. When something goes wrong

| Symptom                                               | Look at                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `TargetDown` for api-1, api-2 and the worker at once  | They refuse Prometheus's token: `METRICS_TOKEN` changed and it kept the old file. `$C up -d --force-recreate prometheus` |
| A firing alert, but no Discord message                | `$AM alert query` (is it there?), `$C logs alertmanager` (did Discord refuse?), `NOTIFIER_DRIVER=discord`?               |
| `/admin` says "Prometheus is not answering"           | `$C ps prometheus`, `$C logs --tail 50 prometheus`; the API's half of the page still works                               |
| Grafana refuses the right password                    | Locked after 5 wrong ones: wait 5 minutes. Forgotten: the reset command in section 2                                     |
| Grafana's panels say "No data"                        | Grafana → **Connections** → Prometheus → **Test**; then `up` from the terminal                                           |
| A dashboard change in the browser can't be saved      | By design: export it into the JSON file (section 2)                                                                      |
| A deploy log shows `WARNING: … grafana …`             | The site was deployed; only the monitoring has a problem. `$C logs grafana`                                              |
| `deploy/prometheus/ is invalid. Nothing was changed.` | The message above it names the line; `npm run monitoring:check` finds it on your computer first                          |

---

## What was tested

On the desktop's stack (2026-11-24), with nothing sent to Discord:

- Stopping api-1: `TargetDown` reached Alertmanager after 137 s while the site answered through
  api-2, and cleared 9 s after api-1 came back. `/admin` named it within one reading.
- The Discord message format against a stand-in for Discord: firing, one of two recovered,
  both resolved.
- A real backup run: its time reached Prometheus within 15 s.
- Grafana: a guest, a wrong password and sign-up refused (401); still open while the site was
  paused; the lockout lifted after about 5 minutes; all 27 dashboard queries ran.
- A full deploy (`npm run stack:deploy -- dev`, 46 s) with the monitoring report at the end; a
  broken Alertmanager file stopped the next one before it changed anything.
- Every alert rule's tests were checked by breaking the rule on purpose.

---

## Check yourself

1. api-1 stops for 90 seconds during a deploy. Does Discord hear about it?
2. Why does Grafana have no access to Postgres?
3. You change `GRAFANA_ADMIN_PASSWORD` in `deploy/.env` and deploy. Which password works?
4. Your laptop's stack stops api-1 for ten minutes. Does a message reach your channel?
5. The "Last backup" panel says 9 days. What has happened, and where do you look?

<details>
<summary>Answers</summary>

1. No. `TargetDown` waits 2 minutes before firing, longer than a replica's restart, so a deploy
   stays quiet. Ten minutes down would fire it.
2. Grafana's login page is on the internet. With only Prometheus behind it (counts and timings,
   no visitors), a stolen Grafana password reveals no personal data. Visitor details stay
   behind `/admin`.
3. The old one. Grafana reads that setting only when it first creates its database; use the
   reset command in section 2.
4. No. Your computers keep `NOTIFIER_DRIVER=log`, which gives Alertmanager `log.yml`: it holds
   the alert (`amtool alert query` shows it) and posts nothing.
5. The weekly backup stopped running (cron line gone, server off) or kept failing, and
   `BackupStale` has fired in Discord. [BACKUPS.md §5](BACKUPS.md#5-when-something-goes-wrong).

</details>
