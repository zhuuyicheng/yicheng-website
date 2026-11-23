# syntax=docker/dockerfile:1

# The website image (DESIGN.md §14.2, docs/DOCKER.md): Next.js's standalone server.
# Build from the repository root (it needs packages/shared):
#   docker build -f apps/web/Dockerfile -t portfolio-web .

ARG NODE_VERSION=24

# ---- base: Debian slim (glibc, for sharp's and Tailwind's prebuilt binaries).
FROM node:${NODE_VERSION}-trixie-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: as in apps/api/Dockerfile (every package.json, no install scripts).
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --include-workspace-root -w @portfolio/shared -w @portfolio/web

# ---- build: the shared contract, then `next build` (writes .next/standalone).
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Baked into the browser bundle at build time (DESIGN.md §14.2). Empty: browsers call /api/...
# on the page's own address, so the image works under any hostname.
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build -w @portfolio/shared && npm run build -w @portfolio/web

# ---- runtime: the standalone server and its static files, owned by root; only Next's image
# cache is writable by `node`. No public/ folder: icons and photos end up in .next/static.
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
# API_BASE_URL, API_REPLICA_URLS and ADMIN_TOKEN are read at run time.
CMD ["node", "apps/web/server.js"]
