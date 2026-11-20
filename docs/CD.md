# Releasing to the server (Phase 6c)

Merging into `main` releases the site: GitHub tests the commit, builds two Docker images, and
waits for **your approval**. Then the server rolls out the new version without dropping an API
request, and goes back to the previous version by itself if the new one fails. Design:
[DESIGN.md §14.3](../DESIGN.md#143-pipeline-githubworkflowsdeployyml-deploydeploysh).

```
merge ─► ci (tests, images build) ─► publish (images → ghcr.io, tag = commit) ─► deploy ⏸ approve
                                                                                    │ SSH
                     server: ~/portfolio/deploy/deploy.sh <sha>  ◄──────────────────┘
                     pull → check → migrate → seed → worker → api-1 → api-2 → web
                     → smoke test ──fails──► back to the previous release
```

`<name>` is your DuckDNS name. Neither it nor the server's IP goes into Git.

---

## 1. What runs where

| Where                 | What                                                    | File                              |
| --------------------- | ------------------------------------------------------- | --------------------------------- |
| GitHub, job `ci`      | format, lint, types, tests, site build, image builds    | `.github/workflows/ci.yml`        |
| GitHub, job `publish` | push both images to GHCR as `…:<commit sha>`            | `.github/workflows/deploy.yml`    |
| GitHub, job `deploy`  | wait for approval, copy `deploy/` to the server, SSH in | `.github/workflows/deploy.yml`    |
| The server            | the deploy itself, and the rollback                     | `deploy/deploy.sh`                |
| The server, not Git   | secrets, hostname, the release now running              | `~/portfolio/deploy/.env`         |
| The server, not Git   | the pause switch, when the site is paused (§5)          | `~/portfolio/deploy/caddy/paused` |

The deploy is a script on the server, not workflow steps, so the same thing runs from GitHub,
by hand on the server, and on your laptop (`npm run stack:deploy -- dev`) where it was tested.
It records the running release in `deploy/.env` (`API_IMAGE`, `WEB_IMAGE`), so every other
command (`backup.sh`, `restore.sh`, `docker compose … up`) uses the same images.

---

## 2. One-time setup (about 20 minutes)

Done on 2026-11-20. Repeat it only for a new server or a new repository. You need the server
from [HOSTING.md](HOSTING.md) (Steps 1–9).

### 2.1 A key for GitHub (laptop)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/portfolio_deploy -N "" -C "github-actions-deploy"
{ printf 'restrict '; cat ~/.ssh/portfolio_deploy.pub; } |
  ssh portfolio 'cat >> ~/.ssh/authorized_keys'

# Test it. -F /dev/null ignores ~/.ssh/config, so your own key can't stand in for it.
ip=$(ssh -G portfolio | awk '$1 == "hostname" { print $2 }')
ssh -F /dev/null -i ~/.ssh/portfolio_deploy -o IdentitiesOnly=yes "ubuntu@$ip" 'echo deploy key works'
```

GitHub gets its own key (no passphrase: nobody is there to type it), so it can be revoked
alone. `restrict` turns off forwarding and terminals. It can still run commands as `ubuntu`,
which is as good as root: only the approved deploy job, from `main`, can read it (§2.3).

### 2.2 The server's settings file

```bash
ssh portfolio 'mkdir -p ~/portfolio/deploy'
scp deploy/.env.example portfolio:portfolio/deploy/.env     # from the repository root
ssh portfolio
chmod 600 ~/portfolio/deploy/.env
openssl rand -hex 32                                        # once per secret below
nano ~/portfolio/deploy/.env
```

| Setting                                                               | Value                                          |
| --------------------------------------------------------------------- | ---------------------------------------------- |
| `SITE_HOST`                                                           | `<name>.duckdns.org`                           |
| `POSTGRES_PASSWORD`, `IP_HASH_SECRET`, `METRICS_TOKEN`, `ADMIN_TOKEN` | a new `openssl rand -hex 32` each              |
| `NOTIFIER_DRIVER`, `DISCORD_WEBHOOK_URL`                              | `discord` and your webhook, or `log` and empty |

- Leave `API_IMAGE` and `WEB_IMAGE` alone: the deploy writes them.
- Copy the whole file into your password manager. `ADMIN_TOKEN` is your `/admin` password.
- A Discord webhook: your server → **Server Settings** → **Integrations** → **Webhooks** →
  **New Webhook** → **Copy Webhook URL**.
- Every value is checked when a container starts; the deploy's first is `migrate`, so a
  missing or too-short value stops the deploy there, by name, before anything changes.

### 2.3 The `production` environment on GitHub

**Set this up before the first deploy**: a job that names a missing environment creates it
without protection, so that deploy would not ask for your approval.

Repository → **Settings** → **Environments** → **New environment** → `production`:

1. **Required reviewers**: yourself → **Save protection rules** (leave _Prevent self-review_
   off: you are the only reviewer).
2. **Deployment branches and tags**: _Selected branches and tags_ → add `main`.
3. **Environment secret** `SSH_PRIVATE_KEY`, straight from the file (pasting a key through
   the clipboard can break it): `gh secret set SSH_PRIVATE_KEY --env production < ~/.ssh/portfolio_deploy`
4. **Environment variables**: `SSH_HOST`, `SITE_HOST` (`<name>.duckdns.org`) and
   `SSH_KNOWN_HOSTS`. The other two come from your laptop:

```bash
ip=$(ssh -G portfolio | awk '$1 == "hostname" { print $2 }')
echo "$ip"                            # SSH_HOST
ssh-keygen -F "$ip" | grep -v '^#'    # SSH_KNOWN_HOSTS: every line it prints
```

Once the first deploy has worked, delete the private key: `rm ~/.ssh/portfolio_deploy`. GitHub
has the only copy it needs. The `.pub` file next to it is not secret; leave it there.

Why: the approval click is what makes this continuous _delivery_; the `main`-only rule means
no other branch can deploy or read the key; `SSH_KNOWN_HOSTS` pins the server's identity, so
the job never talks to an impostor. The app's secrets never leave the server.

---

## 3. Releasing

1. Merge a pull request (`gh pr merge --squash --delete-branch`).
2. **Actions** → the **Deploy** run: `ci`, then `publish (api)` and `publish (web)`, then
   `deploy` shows **Waiting** and GitHub emails you.
3. **Review deployments** → tick `production` → **Approve and deploy** (**Reject** skips it).
4. The step "Deploy (migrate, seed, …)" shows progress (§6). The run's summary links to the site.

```bash
gh run list --workflow deploy.yml --limit 5     # recent deploys
gh run watch                                    # follow one
```

- **Several deploys waiting?** Reject the older ones first, then approve the newest (it
  contains everything before it). Two deploy jobs never run at once.
- **The first deploy** creates the database, applies every migration, publishes the content,
  and Caddy gets its certificate. Then set up backups:
  [BACKUPS.md §2](BACKUPS.md#2-on-the-server-after-the-first-deploy).
- **Images** appear under your profile → **Packages**, private by default; the deploy pulls
  them with the job's own short-lived token.

---

## 4. Rolling back

**Automatically**, when the rollout or smoke test fails (a replica not healthy within 120 s, a
crash, `/health` not 200, the site not answering through Caddy): `deploy.sh` rolls out the
previous release the same way, publishes its content again, smoke-tests it, and fails the job.

```
api-1 is still running/starting after 120 s: see docker compose logs api-1
▶ the new release failed
rolling back to ghcr.io/<owner>/portfolio-api:<previous sha>, …
▶ ROLLED BACK: the previous release serves again. The new one failed: see the log above.
```

- **Not undone: migrations.** They only add things, so the old code works on the new schema
  (DESIGN.md §14.4). That rule is what makes rollback safe.
- **Not undone: the deploy files** (compose file, Caddyfile). If they caused it, go back by hand.
- **Failures before the rollout** (pull, settings, Caddyfile, migration) change nothing: the
  current release keeps running.

**By hand**: **Actions** → **Deploy** → **Run workflow** → branch `main` + the full commit SHA
→ approve. It deploys that commit's images _and_ deploy files. SHAs: **Settings →
Environments → production** lists each deploy, or `git log --format='%H %s' main`.

**On the server** (only the release before the current one is still there):
`bash ~/portfolio/deploy/deploy.sh <full sha>`.

---

## 5. Pausing the site

Takes the site offline for a while: visitors get a "back soon" page, everything else keeps
running.

```bash
ssh portfolio 'touch ~/portfolio/deploy/caddy/paused'    # pause
ssh portfolio 'rm ~/portfolio/deploy/caddy/paused'       # resume
```

- **Instant**: Caddy looks for that file on every request. No restart, nothing lost.
- **Visitors** get [back-soon.html](../deploy/caddy/back-soon.html) (edit it to change the
  words) with status 503 and `Retry-After`, so search engines treat the pause as temporary.
- **Still working**: `/admin` (with your password), the worker, the database, backups, and
  deploys. A deploy leaves the site paused and checks the new release from inside the server.
- **Don't stop the VM** in Oracle's console instead: starting an Arm VM again can fail with
  "out of host capacity".
- **On your laptop's stack**: `touch deploy/caddy/paused`, then https://localhost. Git ignores
  the file.

---

## 6. Reading a deploy's log

The `deploy` job → step **Deploy (migrate, seed, rolling update, smoke test; …)**:

```
▶ deploying 3f2a9c…
▶ pulling the images
▶ checking the settings and the Caddyfile (before anything changes)
▶ migrating the database
▶ publishing the content
▶ worker: the old one stops before the new one starts (one worker at a time)
▶ api-1: Caddy sends every request to the other replica meanwhile
api-1 is healthy; waiting 6 s for Caddy's next health check to see it
▶ api-2: …
▶ web (its pages are unavailable for a few seconds)
▶ smoke test
api-1: GET /health → 200 … GET https://<name>.duckdns.org/ → 200
▶ deployed 3f2a9c… in 36 s
```

States read `status/health/restarts`: `running/starting/0` (starting), `running/healthy/0`
(ready), `restarting/none/3` (crashed 3 times). On the server:

```bash
C="docker compose -f ~/portfolio/deploy/compose.prod.yml"
$C ps                                  # each service's image (= release) and health
$C logs --tail 50 api-1                # why it failed
grep _IMAGE ~/portfolio/deploy/.env    # the release the server considers current
```

---

## 7. Troubleshooting

| Symptom                                                                             | Fix                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Stays at **Waiting**                                                                | Approve it (§3)                                                                                |
| `The production environment is missing: …`                                          | Add the named secret or variables (§2.3)                                                       |
| `Not a full commit SHA`                                                             | Use all 40 characters (`git log --format=%H`)                                                  |
| `Host key verification failed`                                                      | Set `SSH_KNOWN_HOSTS` again (wrong, or the server was rebuilt)                                 |
| `SSH_PRIVATE_KEY is not a usable private key` (or `Load key …: error in libcrypto`) | The secret was pasted incompletely: set it from the file (§2.3 step 3), **Re-run failed jobs** |
| `Permission denied (publickey)`                                                     | The key isn't on the server: §2.1, then its test line                                          |
| `Missing …/deploy/.env`                                                             | §2.2                                                                                           |
| `Invalid environment configuration`                                                 | A value in `deploy/.env` is missing or invalid; the message names it. Fix, **Re-run jobs**     |
| `required variable X is missing a value`                                            | The release needs a new setting: add `X` to `deploy/.env` and your password manager            |
| `could not log in to the registry`                                                  | Re-run the job; if it persists, see the next row                                               |
| `denied` / `unauthorized` while pulling                                             | Package → Package settings → Manage Actions access → add this repository (Read)                |
| `Another deploy is running`                                                         | A deploy started by hand on the server; wait                                                   |
| `ROLLED BACK`                                                                       | The release is broken: the log above says which step                                           |
| `ROLLBACK FAILED`                                                                   | Both releases fail: `$C ps`, `$C logs` (§6); likely the database or disk                       |
| "Check from the internet" fails                                                     | The server works but isn't reachable: DNS or Oracle's firewall ([HOSTING.md](HOSTING.md))      |
| The site shows "Back soon"                                                          | It is paused: `ssh portfolio 'rm ~/portfolio/deploy/caddy/paused'` (§5)                        |

**A new deploy key**: make one (§2.1), set the secret again (§2.3 step 3), then delete the old
`github-actions-deploy` line from the server's `~/.ssh/authorized_keys` (`ssh-keygen -l -f`
on that file lists each key's fingerprint).

---

## 8. What protects what

| Credential                  | Lives                        | Protected by                                                      |
| --------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| Deploy key                  | GitHub (environment secret)  | your approval, `main` only, `restrict`, pinned host key           |
| Registry token              | the deploy job, for its run  | expires with the job; on the server only in a deleted temp folder |
| App secrets (`deploy/.env`) | the server, password manager | owner-only file, never in GitHub or Git                           |

---

## What was tested

- **On the laptop stack** (2026-11-19), with a request every 50 ms:
  - a new release: all 503 API requests succeeded; pages answered `502` five times while `web`
    restarted;
  - a release whose API never answers: stopped at api-1 and rolled back; all 1,302 requests
    succeeded;
  - a crashing worker: rolled back;
  - the same release again, and the clean-up of old images;
  - an invalid Caddyfile, a missing setting, a missing image, two deploys at once: each stopped
    before changing anything.
- **On the server** (2026-11-20): the script, compose file and Caddyfile are valid under the
  server's versions, and ports 80/443 reach a container from the internet.
- **First real deploy** (2026-11-20): 87 s on the server; the smoke test and the check from
  the internet passed.
- **The pause** (laptop stack, 2026-11-20): pages, API and project pages answer 503 with the
  "back soon" page; `/admin` asks for its password and works with it; pausing and resuming
  take effect at once; a deploy while paused passes and leaves the site paused. Its checks
  fail when they should: API replicas stopped, the site not actually paused, the page missing.

The first version trusted `docker compose up --wait`, which reports success when its timeout
passes while a container is still _starting_: a dead replica got through and the script took
down the other one (11 failed requests). The script now polls Docker's health state itself.
