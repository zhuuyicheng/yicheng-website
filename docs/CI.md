# Continuous Integration (GitHub Actions)

On every pull request, GitHub starts a fresh Linux machine and runs what `npm run check` runs
locally, plus the website's production build and both Docker images. Red ❌ means fix before
merging; green ✅ means safe to merge. Minutes are free because the repository is public.

---

## 1. What runs

The workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

| Job           | Runs on                         | Does                                                                                                            |
| ------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `check`       | `ubuntu-latest`                 | `npm ci`, format check, lint, typecheck, all tests, monitoring config and alert tests, `next build` of the site |
| `image (api)` | `ubuntu-24.04-arm` (GitHub Arm) | builds the API image for the server's Arm CPU (pushes nothing)                                                  |
| `image (web)` | `ubuntu-24.04-arm`              | builds the web image                                                                                            |

| Locally            | In CI                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `nvm use`          | `actions/setup-node` reading `.nvmrc`                               |
| `npm install`      | `npm ci` (stricter: fails if `package-lock.json` is out of date)    |
| `npm run infra:up` | `services:` Postgres and Redis containers, started before the steps |
| `npm run check`    | the `run:` steps after `npm ci`                                     |

- The integration tests need no setup: their defaults (`localhost:5432`, Redis DB 1) match the
  service containers, and they create the `portfolio_test` database themselves.
- A newer push to the same branch cancels the older run.
- **On `main`**, CI runs inside the **Deploy** workflow (`deploy.yml` calls `ci.yml`), so a
  commit is tested once and only a passing one is published ([CD.md](CD.md)).

---

## 2. Day to day

```bash
git switch -c feat/my-change          # one branch per change
npm run check                         # verify locally first: faster than waiting for CI
git add -A && git commit -m "feat: …" && git push -u origin feat/my-change
gh pr create --fill                   # open the pull request
gh pr checks --watch                  # watch CI (or the PR's "Checks" tab)
gh pr merge --squash --delete-branch  # when green
git switch main && git pull
```

`gh pr checks --watch` and `gh run rerun --failed` (§3) need a current `gh`. Ubuntu's own
package is version 2.4 from 2022 (`gh --version`), which lacks both: install the current one
with [GitHub's instructions](https://github.com/cli/cli/blob/trunk/docs/install_linux.md), or
use the PR's **Checks** tab and the **Re-run failed jobs** button instead.

---

## 3. When CI fails

Open the run (**Actions** → the run → the red job → the red step): the log shows the same
error you would get locally. Reproduce, fix, push; CI runs again.

```bash
gh run list --limit 5          # recent runs
gh run view --log-failed       # only the failed steps' logs
gh run rerun --failed          # retry (e.g. a flaky network error)
```

| Failure                           | Typical reason                                                          | Local fix                                 |
| --------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| `format:check`                    | Not run through Prettier                                                | `npm run format`                          |
| `lint`                            | Rule violation                                                          | `npm run lint:fix`, then the rest by hand |
| `npm ci`                          | `package.json` changed without the lockfile                             | `npm install`, commit `package-lock.json` |
| `build -w @portfolio/web`         | A page that needs the API while building                                | `npm run build -w @portfolio/web`         |
| Integration tests only fail in CI | The test depends on local data or timing                                | Make the test create its own data         |
| Lint or types only fail in CI     | A gitignored generated file exists only on your laptop                  | Check a fresh clone (below)               |
| `image (api)` / `image (web)`     | A Dockerfile step fails                                                 | `npm run image:api` / `npm run image:web` |
| `monitoring:check`                | A refused config file, a failing alert test, or two Prometheus versions | `npm run monitoring:check` names it       |

**"It passes on my laptop"**: your folder has files CI never sees (`node_modules`, `.next/`,
generated files like `apps/web/next-env.d.ts`). Once, photo imports got their types only from
that generated file, so lint failed in CI alone (fixed by `apps/web/src/image-imports.d.ts`).
Check what CI sees:

```bash
git clone . /tmp/ci-check && cd /tmp/ci-check   # committed files only
npm ci && npm run format:check && npm run lint && npm run typecheck
cd - && rm -rf /tmp/ci-check
```

---

## 4. Protecting `main`

`main` is protected by a ruleset, "Protect main" (since 2026-11-20). A change reaches `main`
only through a pull request whose `check`, `image (api)` and `image (web)` jobs passed. Force
pushes and deleting `main` are blocked, and nobody can bypass the rules, the owner included.

- **See the rules**: **Settings → Rules → Rulesets**, or
  `gh api repos/{owner}/{repo}/rules/branches/main`.
- **Set it up again** (a new repository or a fork): **Settings → Rules → Rulesets → New
  branch ruleset**, target `main`, then turn on _Restrict deletions_, _Require a pull request
  before merging_, _Require status checks to pass_ (add the three jobs above) and _Block force
  pushes_.
- **Renaming a CI job?** Update the required checks too, or every pull request waits for a
  check that never reports.
