# Start here

A map for picking the project back up, and for the "how do I…?" moments. Each item says what to
do in a line or two and links the guide with the full steps. How everything _works_ is in
[PROJECT-GUIDE.md](PROJECT-GUIDE.md); this page is about getting things done.

Commands run in your Ubuntu (WSL) terminal, inside the project folder
(`cd ~/projects/yicheng-website`), unless they start with `ssh portfolio`. On the server, many
commands start with `$C`, a shortcut to type once after logging in:

```bash
C="docker compose -f $HOME/portfolio/deploy/compose.prod.yml"
```

(`$HOME`, not `~`: inside quotes the shell leaves `~` as it is, and Compose then looks for a
folder literally called `~`.)

---

## 1. Coming back after a while

1. **Is the site fine?** Open it, and `/admin` (any username, password = `ADMIN_TOKEN` from your
   password manager). GitHub → **Actions**: the latest runs are green. Discord: a
   "Portfolio backup OK" message every Sunday.
2. **Copy the backups home**, your copy if the server is ever lost:
   `bash deploy/pull-backups.sh`
   ([BACKUPS.md §3.4](BACKUPS.md#34-copying-the-backups-home-whenever-you-like)).
3. **Bring this computer up to date.** Start Docker Desktop first, then:

   ```bash
   git switch main && git pull
   nvm use && npm install
   npm run infra:up && npm run db:migrate && npm run content:seed
   npm run check        # everything CI runs: if it passes, this computer is ready
   ```

   On a computer that has never had the project:
   [README, "Working on another machine"](../README.md#working-on-another-machine). To reach the
   server from it, also copy `~/.ssh/portfolio_vm` (your key) and the `Host portfolio` lines of
   `~/.ssh/config`.

4. **What was left open**: the unticked items in [ROADMAP.md](../ROADMAP.md).
5. **Oracle**: Billing & Cost Management → **Cost Analysis** shows $0, and the instance
   `portfolio` is Running.

---

## 2. Change what the site says

Nothing here is live until you ship it ([section 3](#3-put-a-change-live)).

- **Text about you** (name, headline, About, jobs, education, links): edit
  [apps/api/content/portfolio.json](../apps/api/content/portfolio.json), run
  `npm run content:seed`, reload the page.
  [EDITING-THE-SITE.md §1](EDITING-THE-SITE.md#1-your-content-portfoliojson) says which field
  appears where.
- **Add, change or remove a project**: the `projects` list in the same file. `slug` is its address
  (`/<slug>`), `title` and `summary` make the card, `description` and `sections` its page,
  `featured: true` puts it first. Same guide, "Project sections".
- **Page wording** (section titles, buttons, header, footer, form messages): the `.tsx` file in
  the table of [EDITING-THE-SITE.md §2](EDITING-THE-SITE.md#2-page-wording-the-tsx-files). Can't
  find some text? In VS Code, **Ctrl+Shift+F** with a few exact words from the page.
- **Photos** (the carousel, the collage beside your name): shrink the photo and strip its GPS
  data, then list it in `apps/web/src/content/photos.ts`
  ([EDITING-THE-SITE.md §3](EDITING-THE-SITE.md#3-photos)).
- **The "back soon" page** shown while the site is paused: `deploy/caddy/back-soon.html`.
- **See it on your computer first**: `npm run infra:up` once, then `npm run dev:api` and
  `npm run dev:web` in two terminals, and open http://localhost:3000. Add `npm run dev:worker`
  in a third to have visits and contact messages processed too.

---

## 3. Put a change live

Every change, text or code, takes the same road:

```bash
git switch -c feat/my-change
npm run check                          # what CI will run: faster to find out here
git add -A && git commit -m "feat: what changed" && git push -u origin feat/my-change
gh pr create --fill
# when the pull request's checks are green:
gh pr merge --squash --delete-branch
git switch main && git pull
```

Then GitHub emails you: **Actions** → the **Deploy** run → **Review deployments** → tick
`production` → **Approve and deploy**. About a minute later it's live; the deploy publishes
`portfolio.json` by itself ([CI.md §2](CI.md#2-day-to-day), [CD.md §3](CD.md#3-releasing)).

- **CI is red**: [CI.md §3](CI.md#3-when-ci-fails).
- **Follow a deploy**: `gh run watch`; what its log says: [CD.md §6](CD.md#6-reading-a-deploys-log).
- **A release is bad**: if its checks fail, the deploy goes back to the previous release by
  itself. To go back by hand: **Actions** → **Deploy** → **Run workflow** with the previous
  commit's full SHA → approve ([CD.md §4](CD.md#4-rolling-back)).
- **Several deploys waiting**: reject the older ones, approve the newest (it has everything).
- **Take the site offline for a while**: `ssh portfolio 'touch ~/portfolio/deploy/caddy/paused'`;
  `rm` instead of `touch` brings it back ([CD.md §5](CD.md#5-pausing-the-site)).

---

## 4. Visitors, messages and backups

- **Who visited**: `/admin`, then pick a period. The page explains each number;
  [PROJECT-GUIDE.md §8](PROJECT-GUIDE.md#8-making-sense-of-the-data) goes deeper.
- **Who opened a link you shared**: add `?ref=<name>` to it, e.g. `https://<your site>/?ref=acme`
  ([PROJECT-GUIDE.md §6](PROJECT-GUIDE.md#6-using-the-website)).
- **Contact messages** arrive in Discord, and are kept in the database
  ([PROJECT-GUIDE.md §4.4](PROJECT-GUIDE.md#44-the-contact-form)).
- **"Dead letters" on `/admin`'s queue card**: visits or notifications that failed for good.
  **Show items** under the list says what each one was, why it failed, and what to fix before
  retrying. Once the cause is fixed, retry them on the server with
  `$C run --rm replay-dlq telemetry` (or `notifications`); `npm run dlq:replay` is the same on
  your computer. The fixes, reason by reason:
  [PROJECT-GUIDE.md §8](PROJECT-GUIDE.md#8-making-sense-of-the-data) ("A dead-letter queue is
  not empty?").
- **What is waiting in a queue** (visits not saved yet, messages you have not been told about):
  `/admin` → queue card → **Show items**.
- **Look inside the database or Redis**: on your computer, in VS Code
  ([DATA-TOOLS.md](DATA-TOOLS.md)); ready-made queries in [docs/sql/](sql/).
- **Backups**, all in [BACKUPS.md](BACKUPS.md):
  - copy them home: `bash deploy/pull-backups.sh` (§3.4);
  - make one right now: `ssh portfolio 'bash ~/portfolio/deploy/backup.sh'`;
  - restore one, on the server: `bash ~/portfolio/deploy/restore.sh <file>`
    ([§4](BACKUPS.md#4-restoring));
  - after a restore, bring back the visits and messages that came after the backup
    ([§4](BACKUPS.md#bringing-back-the-visits-and-messages-that-came-after-the-backup));
  - practise a restore without risk, on your computer:
    [§4, "Practise on your laptop"](BACKUPS.md#practise-on-your-laptop).

---

## 5. The server

- **Log in**: `ssh portfolio` (it asks for your key's passphrase); `exit` to leave.
- **What runs, and its logs**: `$C ps`, then `$C logs --tail 50 api-1`. The services are
  `caddy`, `api-1`, `api-2`, `worker`, `web`, `postgres`, `redis` and the monitoring's
  `prometheus`, `alertmanager`, `node-exporter`, `grafana` ([CD.md §6](CD.md#6-reading-a-deploys-log)).
- **How the site did over hours or days**: Grafana at `https://<your site>/grafana`, user
  `admin`, password `GRAFANA_ADMIN_PASSWORD` ([MONITORING.md §2](MONITORING.md#2-grafana)).
- **An alert in Discord** ("Firing: …"): its message says what to try first; every alert,
  explained: [MONITORING.md §3](MONITORING.md#3-alerts). Planned work that will stop
  something? Silence it first (same section).
- **Change a secret or setting** (the Discord webhook, your `/admin` password `ADMIN_TOKEN`, …):
  `nano ~/portfolio/deploy/.env` on the server, update your password manager, then deploy the
  current release again: **Actions** → **Deploy** → **Run workflow** with the SHA left empty →
  approve. Each service whose settings changed restarts, one at a time
  ([CD.md §2.2](CD.md#22-the-servers-settings-file) lists the settings).
- **System updates** install by themselves. When the login message says
  `*** System restart required ***`, run `sudo reboot`: the site is gone for about a minute,
  then everything starts again by itself. The login message also offers a new Ubuntu release
  (`do-release-upgrade`): leave it. 24.04 gets security updates until 2029, and moving to a new
  release is a project of its own.
- **HTTPS certificates**: Caddy renews them by itself.
- **IP-location data** (the places and organisations on `/admin`): the first deploy of each
  month downloads that month's files, so shipping something now and then keeps it fresh.
- **Oracle's idle rule**: a free VM whose memory stays under 20 % for a week may be reclaimed.
  Check **Metrics** → **Memory utilization** now and then
  ([HOSTING.md, "Check yourself", question 3](HOSTING.md#check-yourself)).
- **Switch to `<name>.is-a.dev`**: the "Later" section of [HOSTING.md](HOSTING.md). Write that
  request yourself: their rules forbid AI-written ones.
- **The server is lost**: rebuild it ([HOSTING.md, "If the VM is lost"](HOSTING.md#if-the-vm-is-lost)),
  then restore your newest desktop copy ([BACKUPS.md §4](BACKUPS.md#4-restoring)).

---

## 6. Build something new

- **Find your way around the code**: folders and layers in
  [PROJECT-GUIDE.md §3](PROJECT-GUIDE.md#3-find-your-way-around-the-code), each feature followed
  through the code in [§4](PROJECT-GUIDE.md#4-code-flows-feature-by-feature).
- **A new API endpoint**: one file per layer, like the existing features (the `content.*` files
  are a good model): the request/response schema in `packages/shared`, then controller → manager
  (`services/`) → DAL → view, with tests. The rules:
  [CLAUDE.md, "Architecture rules"](../CLAUDE.md#architecture-rules-see-designmd-22); the design:
  [DESIGN.md §2.2](../DESIGN.md#22-layering-api) and [§7](../DESIGN.md#7-http-api-contracts).
- **A database change**: a new numbered file in `apps/api/migrations/`, never an edit to one
  already applied, then `npm run db:migrate`. It may only _add_, because the running release
  keeps using the database during a deploy
  ([DESIGN.md §5.1](../DESIGN.md#51-migration-mechanics),
  [§14.4](../DESIGN.md#144-rules-this-imposes-on-every-phase)).
- **A new kind of content** (say, a certifications list): every file it touches is in
  [GUIDED-TOUR.md, Station 12](GUIDED-TOUR.md#station-12-check-yourself), question 5. When a
  response changes shape, its cache key gets a new version (`cache:v3:…` → `v4`), as explained
  in [CONTENT-AND-CACHE.md](CONTENT-AND-CACHE.md).
- **A website page or component**: `apps/web/src` (`app/` pages, `components/`, `lib/` logic
  with unit tests). Read `apps/web/AGENTS.md` first: Next.js 16 differs from older tutorials
  ([DESIGN.md §8.6](../DESIGN.md#86-the-website-phase-5)).
- **Tests**: running them in [TESTING.md §3](TESTING.md#3-everyday-commands), writing one in
  [§7](TESTING.md#7-writing-a-new-test). Every new behaviour gets a test, every bug fix a test
  that would have caught it.
- **The real production setup, on your computer**: `npm run image:api && npm run image:web`, then
  `npm run stack:up` (https://localhost) and `npm run stack:deploy -- dev` for a deploy the
  server's way ([PRODUCTION-STACK.md §3](PRODUCTION-STACK.md#3-start-it)).
- **With Claude Code**: it reads [CLAUDE.md](../CLAUDE.md) (the project's rules) by itself, and
  ROADMAP.md tells it what's open. Its notes about how you work are kept per computer.

---

## 7. When something is wrong

| Symptom                                     | Look at                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The site shows an error or doesn't load     | `ssh portfolio`, `$C ps`, `$C logs --tail 50 <service>`; [CD.md §7](CD.md#7-troubleshooting)                                      |
| A deploy failed or says `ROLLED BACK`       | Its log: [CD.md §6–7](CD.md#6-reading-a-deploys-log)                                                                              |
| No "Portfolio backup OK" on a Sunday        | [BACKUPS.md §5](BACKUPS.md#5-when-something-goes-wrong)                                                                           |
| "Firing: …" in Discord                      | The message's last line; then [MONITORING.md §3](MONITORING.md#3-alerts)                                                          |
| Grafana won't log you in, or shows no data  | [MONITORING.md §6](MONITORING.md#6-when-something-goes-wrong)                                                                     |
| The copy command says `PROBLEM` or `FAILED` | [BACKUPS.md §5](BACKUPS.md#5-when-something-goes-wrong)                                                                           |
| CI is red                                   | [CI.md §3](CI.md#3-when-ci-fails)                                                                                                 |
| Tests fail on your computer                 | [TESTING.md §6](TESTING.md#6-troubleshooting)                                                                                     |
| `ssh portfolio` fails                       | [HOSTING.md, Troubleshooting](HOSTING.md#troubleshooting)                                                                         |
| `content:seed` refuses `portfolio.json`     | It lists every problem and where; the JSON pitfalls in [EDITING-THE-SITE.md §1](EDITING-THE-SITE.md#1-your-content-portfoliojson) |
| Contact messages stop arriving in Discord   | `/admin`'s queue card: dead letters? **Show items** says why; then [section 4](#4-visitors-messages-and-backups)                  |
| An Oracle bill that isn't $0                | Cost Analysis; your $1 budget alert emails you first                                                                              |

---

## 8. Where things live

| What                                 | Where                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| Text about you                       | `apps/api/content/portfolio.json`                                                    |
| Photos                               | `apps/web/src/content/photos.ts` and `photos/` next to it                            |
| Page wording                         | `apps/web/src/app/` and `components/`                                                |
| The server's settings and secrets    | `~/portfolio/deploy/.env` on the server, and your password manager                   |
| Deploy key, server address, hostname | GitHub → **Settings** → **Environments** → `production`                              |
| Backups                              | Server: `~/backups/portfolio` (newest 4). Desktop: Documents\portfolio-backups       |
| Alert rules, the dashboard           | `deploy/prometheus/alerts.yml`, `deploy/grafana/dashboards/portfolio.json`           |
| Your hostname's IP                   | DuckDNS (keep its token private)                                                     |
| What's done and what's open          | [ROADMAP.md](../ROADMAP.md)                                                          |
| Every design decision                | [DESIGN.md](../DESIGN.md)                                                            |
| Every guide, and what it's for       | [README.md](../README.md), [PROJECT-GUIDE.md §11](PROJECT-GUIDE.md#11-deeper-guides) |
