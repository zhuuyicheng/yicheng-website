# syntax=docker/dockerfile:1

# The API image (DESIGN.md §14.2, docs/DOCKER.md). One image, several commands:
#   node dist/main.js                 the API (default)
#   node dist/worker.js               the background worker
#   node dist/cli/migrate.js          migrations (once per release)
#   node dist/cli/seed-content.js     publish content/portfolio.json
#   node dist/cli/replay-dlq.js <queue>
# Build from the repository root (it needs packages/shared):
#   docker build -f apps/api/Dockerfile --build-arg GEOIP_MONTH=$(date +%Y-%m) -t portfolio-api .

ARG NODE_VERSION=24

# ---- base: Debian slim (glibc, which the prebuilt native packages expect; Alpine's musl
# is smaller but surprising).
FROM node:${NODE_VERSION}-trixie-slim AS base
WORKDIR /app

# ---- deps: every dependency, dev tools included. Package files first, so this slow layer is
# reused until they change; all of them, since npm checks every workspace against the lockfile.
# --ignore-scripts: postinstall would build packages/shared before its source is here.
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --include-workspace-root -w @portfolio/shared -w @portfolio/api

# ---- build: the shared contract, then the API, to dist/.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @portfolio/shared && npm run build -w @portfolio/api

# ---- geoip: this month's DB-IP files (~140 MB, DESIGN.md §8.2). Its own stage with only the
# downloader, so code changes reuse the cached download. GEOIP_MONTH is in the cache key, so
# each month's first build fetches fresh files.
FROM deps AS geoip
ARG GEOIP_MONTH=unknown
COPY apps/api/src/cli/download-geoip.ts apps/api/src/cli/
COPY apps/api/src/infra/ip-databases.ts apps/api/src/infra/logger.ts apps/api/src/infra/
WORKDIR /app/apps/api
RUN echo "DB-IP files for ${GEOIP_MONTH}" && npx tsx src/cli/download-geoip.ts

# ---- prod-deps: production dependencies only.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @portfolio/shared -w @portfolio/api \
  && mkdir -p apps/api/node_modules

# ---- runtime: files owned by root, process run as `node`, so it can't change its own code.
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
# No HEALTHCHECK: the worker and CLIs share this image and serve no HTTP (compose checks the
# API). Node is PID 1: the API and worker handle SIGTERM themselves (DESIGN.md §10).
CMD ["node", "dist/main.js"]
