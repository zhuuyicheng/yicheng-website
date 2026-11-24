# .github: CI and the deploy workflow

- `workflows/ci.yml` runs what `npm run check` runs, then the website's build and both Docker
  images (docs/CI.md). Change the two together, so a local `npm run check` stays CI's check.
- `workflows/deploy.yml` is the first half of a release and `deploy/deploy.sh` the second.
  Their rules, from `deploy/CLAUDE.md`:

@../deploy/CLAUDE.md
