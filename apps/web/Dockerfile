# syntax=docker/dockerfile:1

# The website image (DESIGN.md §14.2): Next.js's standalone server, which holds only the files
# the pages need. Build from the repository root (it needs packages/shared too):
#   docker build -f apps/web/Dockerfile -t portfolio-web .
# Guide: docs/DOCKER.md

ARG NODE_VERSION=24

# ---- base: Node on Debian slim (glibc, which sharp's and Tailwind's prebuilt binaries need).
FROM node:${NODE_VERSION}-trixie-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: every dependency of the site and the shared contract, from the lockfile. See
# apps/api/Dockerfile for why every package.json is copied and why install scripts are skipped.
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --include-workspace-root -w @portfolio/shared -w @portfolio/web

# ---- build: the shared contract, then `next build`, which writes .next/standalone.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Copied into the browser's JavaScript at build time, not read at run time (DESIGN.md §14.2).
# Empty: browsers call /api/... on the page's own address, which Caddy sends to the API, so
# the image contains no hostname and works under any of them.
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build -w @portfolio/shared && npm run build -w @portfolio/web

# ---- runtime: the standalone server plus the static files it serves (JavaScript, CSS,
# photos). Files belong to root; only Next's cache folder (resized images) is writable by the
# unprivileged `node` user the server runs as. There is no public/ folder to copy: icons live
# in src/app and photos are imported, so both end up in .next/static.
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
# API_BASE_URL (where the server fetches content) and ADMIN_TOKEN are read at run time.
CMD ["node", "apps/web/server.js"]
