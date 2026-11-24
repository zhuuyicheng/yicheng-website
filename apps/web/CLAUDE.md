# apps/web: the website and `/admin` (Next.js 16)

@AGENTS.md

`next` is installed at the repo root (npm workspaces), so the guides AGENTS.md means are in the
root's `node_modules/next/dist/docs/`; there is no `apps/web/node_modules/next`.

**In DESIGN.md**: §8.6 (the website), §8.7 (the owner area, `/admin`), §7 (the API answers it
reads), §12 (what the page-view beacon may collect).

- Server Components fetch through `src/lib/api.ts` (validated with `@portfolio/shared`).
  Logic without React goes in `src/lib/` and gets unit tests in `test/lib/`; `'use client'`
  only where a component needs the browser.
- Effects enhance server-rendered content, never hide it: respect `prefers-reduced-motion`,
  drive scroll effects through CSS variables, not React state. Check phone widths.
- `/admin` (§8.7): `proxy.ts` asks for the password, and every page and route under `app/admin`
  checks it again itself (`checkOwner`). The browser gets owner data only through those routes,
  which call the API's owner endpoints with `ADMIN_TOKEN`; Caddy refuses those endpoints from
  outside the server.
- Web unit tests (`test/lib`, mirrors `src/lib`) cover logic without React or a browser;
  `next build` (run by CI) must succeed without the API.
