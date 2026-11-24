# deploy: the production stack and its release

The Docker Compose stack that runs on the Oracle server and, with `npm run stack:*`, on the
laptop (DESIGN.md §14–15; guides: docs/PRODUCTION-STACK.md, CD.md, BACKUPS.md, MONITORING.md).
A release is `.github/workflows/deploy.yml`, then `deploy.sh <sha>` on the server: check →
migrate → seed → roll out worker → api-1 → api-2 → web → smoke test, going back to the previous
release if the rollout or the smoke test fails (§14.3).

**In DESIGN.md**: §14.3 (pipeline), §14.4 (the rules it imposes), §14.5 (hosting, Caddy, the
rolling update), §14.6 (backups), §15 (monitoring).

- **The approval gate stays**: the deploy job runs in the GitHub environment `production`,
  which waits for the owner's approval and only then hands over the server's SSH key. Never
  remove it: switching to continuous deployment is for the owner to decide.
- **Old and new code overlap**: migrations run before the rollout, and the two API replicas are
  replaced one at a time. Hence expand → contract migrations, versioned cache keys and defaulted
  contract fields (§14.4; how: `apps/api/CLAUDE.md`, `packages/shared/CLAUDE.md`).
- **One worker at a time**: the rollout stops the old worker before starting the new one (§8.4).
- **A rollback restores images and content, not the schema**: migrations only go forward.
- **No secrets in Git or images**: production values live only in `deploy/.env` on the server
  (owner-only, gitignored; `.env.example` lists them). GitHub holds just what the deploy job
  needs to reach the server. The hostname isn't in Git either.
- **The server keeps two files of its own**: the deploy copies `deploy/` with rsync but never
  touches `.env` (secrets and the current release) or `caddy/paused` (the pause switch,
  docs/CD.md §5). Keep both excluded.
- **Only Caddy publishes ports** (80, 443, 443/udp): everything else, the datastores and the
  monitoring included, is reached on the Compose network or through Caddy. Caddy refuses
  `/api/v1/admin/*` from outside the server (§12, §14.5).
- **Redis is a datastore**: keep AOF persistence and the `volatile-lru` policy (§14.4).
- **Monitoring config**: `npm run monitoring:check` (part of `npm run check` and CI) checks both
  Prometheus files, the alert rules' tests, both Alertmanager files and Grafana's dashboards,
  and that development and production run the same Prometheus image.
- Try a change on the laptop stack before it reaches the server: build the images
  (`npm run image:api`, `npm run image:web`), start the stack (`npm run stack:up`), then deploy
  the server's way (`npm run stack:deploy -- dev`; docs/PRODUCTION-STACK.md §3).
