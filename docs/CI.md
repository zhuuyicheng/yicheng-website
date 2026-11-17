# Continuous Integration (GitHub Actions)

CI is the first deliverable of Phase 2. This guide explains what it does and how to use it.

---

## 1. What CI is, in one paragraph

Every time you push a commit or open a pull request, GitHub starts a fresh Linux machine,
checks out your code, installs dependencies, starts Postgres and Redis, and runs exactly what
`npm run check` runs locally: format check, lint, typecheck, unit tests and integration
tests. If any step fails, the commit/PR gets a red ❌; if all pass, a green ✅. This catches
"works on my machine" problems and stops broken code from reaching `main`.

Because the repository is public, GitHub Actions minutes are free.

---

## 2. The workflow file

GitHub looks for YAML files in `.github/workflows/`. Ours will be `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main] # every commit that lands on main
  pull_request: # every PR, whatever the target branch

# A new push to the same branch cancels the previous, now outdated, run.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    # Disposable Postgres + Redis containers, the CI equivalent of docker-compose.yml.
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: portfolio
          POSTGRES_PASSWORD: portfolio
          POSTGRES_DB: portfolio
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U portfolio -d portfolio"
          --health-interval 5s --health-timeout 3s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s --health-timeout 3s --health-retries 10

    steps:
      - uses: actions/checkout@v7 # download the repository
      - uses: actions/setup-node@v7 # install Node (version from .nvmrc)
        with:
          node-version-file: .nvmrc
          cache: npm # reuse downloaded packages between runs
      - run: npm ci # clean install from package-lock.json
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test # unit + integration (uses the service containers)
```

How the pieces map to what you already know:

| Locally            | In CI                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| `nvm use`          | `actions/setup-node` with `node-version-file: .nvmrc`                           |
| `npm install`      | `npm ci` (stricter: fails if `package-lock.json` is out of date)                |
| `npm run infra:up` | `services:` block (containers start before the steps and wait for healthchecks) |
| `npm run check`    | the four `run:` steps                                                           |

The integration tests need no extra configuration: their default connection strings
(`localhost:5432`, user `portfolio`, Redis DB 1) match the service containers, and the test
setup creates the `portfolio_test` database itself.

---

## 3. Day-to-day workflow with CI

```bash
# 1. Start a phase on its own branch
git switch -c feat/portfolio-cache-api

# 2. Work, then verify locally first (fast feedback, saves a CI round trip)
npm run check

# 3. Commit and push the branch
git add -A
git commit -m "feat: add content cache service"
git push -u origin feat/portfolio-cache-api

# 4. Open a pull request (or use the link git prints after pushing)
gh pr create --fill

# 5. Watch CI from the terminal...
gh pr checks --watch
# ...or in the browser: the PR's "Checks" tab, or the repository's "Actions" tab.

# 6. When CI is green, merge and clean up
gh pr merge --squash --delete-branch
git switch main && git pull
```

---

## 4. When CI fails

1. Open the failed run: **Actions** tab → click the run → click the `check` job.
2. Expand the red step (e.g. `npm run lint`). The log shows the same error you would see
   locally.
3. Reproduce locally with the same command, fix it, commit, push. CI re-runs automatically.

Useful terminal commands:

```bash
gh run list --limit 5          # recent runs and their status
gh run view --log-failed       # print only the logs of failed steps
gh run rerun --failed          # retry failed jobs (e.g. after a flaky network error)
```

Common causes:

| Failure                           | Typical reason                                             | Local fix                                      |
| --------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `format:check`                    | Code not run through Prettier                              | `npm run format`                               |
| `lint`                            | Rule violation                                             | `npm run lint:fix`, then fix the rest by hand  |
| `npm ci`                          | `package.json` changed without updating the lockfile       | `npm install`, commit `package-lock.json`      |
| Integration tests only fail in CI | Test depends on local state (data left in your DB, timing) | Make the test create its own data and clean up |

---

## 5. Protecting `main` (recommended once CI exists)

On GitHub: **Settings → Branches → Add branch ruleset** for `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass → select `check`
- ✅ Block force pushes

After this, nothing can reach `main` without a green CI run, including your own pushes.
