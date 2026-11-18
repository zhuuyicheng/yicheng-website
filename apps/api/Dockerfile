# syntax=docker/dockerfile:1

# The API image (DESIGN.md §14.2). One image, several commands; the default starts the API:
#
#   node dist/main.js                 the API (default)
#   node dist/worker.js               the background worker
#   node dist/cli/migrate.js          apply migrations (once per release)
#   node dist/cli/seed-content.js     publish content/portfolio.json
#   node dist/cli/replay-dlq.js <queue>
#
# Build from the repository root (it needs packages/shared too):
#   docker build -f apps/api/Dockerfile --build-arg GEOIP_MONTH=$(date +%Y-%m) -t portfolio-api .
# Guide: docs/DOCKER.md

ARG NODE_VERSION=24

# ---- base: Node on Debian slim. Debian uses glibc, which the prebuilt native packages in
# package-lock.json are built for; Alpine's musl is smaller but a common source of surprises.
FROM node:${NODE_VERSION}-trixie-slim AS base
WORKDIR /app

# ---- deps: every dependency of the API and the shared contract, dev tools included (tsc,
# tsx). Only the package files are copied first, so this slow layer is reused until they change.
# Every workspace's package.json is needed: npm checks them all against the lockfile.
# --ignore-scripts: the repository's postinstall would build packages/shared before its source
# is here (the build stage does it instead); no runtime dependency has an install script.
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --include-workspace-root -w @portfolio/shared -w @portfolio/api

# ---- build: compile the shared contract, then the API, from TypeScript to dist/.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @portfolio/shared && npm run build -w @portfolio/api

# ---- geoip: this month's DB-IP files (~140 MB, DESIGN.md §8.2). A stage of its own that copies
# only the downloader and the two modules it imports (tsx runs them as TypeScript), so code
# changes elsewhere reuse the cached download. GEOIP_MONTH is part of the cache key: CI passes
# the current month, so each month's first build downloads fresh files.
FROM deps AS geoip
ARG GEOIP_MONTH=unknown
COPY apps/api/src/cli/download-geoip.ts apps/api/src/cli/
COPY apps/api/src/infra/ip-databases.ts apps/api/src/infra/logger.ts apps/api/src/infra/
WORKDIR /app/apps/api
RUN echo "DB-IP files for ${GEOIP_MONTH}" && npx tsx src/cli/download-geoip.ts

# ---- prod-deps: only what runs in production: no TypeScript, no test tools.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @portfolio/shared -w @portfolio/api \
  && mkdir -p apps/api/node_modules

# ---- runtime: what the server actually runs. Files belong to root and the process runs as
# the unprivileged `node` user, so a compromised process cannot change its own code.
FROM base AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    GEOIP_ASN_DB_PATH=data/geoip/dbip-asn-lite.mmdb \
    GEOIP_LOCATION_DB_PATH=data/geoip/dbip-city-lite.mmdb
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY apps/api/content apps/api/content
COPY --from=geoip /app/apps/api/data/geoip apps/api/data/geoip
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# No HEALTHCHECK here: the worker and the CLIs use this image too and serve no HTTP. Compose
# checks the API service instead (Phase 6b). Node runs as PID 1 directly: the API and worker
# handle SIGTERM themselves (graceful shutdown, DESIGN.md §10).
CMD ["node", "dist/main.js"]
