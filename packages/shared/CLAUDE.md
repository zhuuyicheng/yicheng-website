# packages/shared: the API contract

The Zod schemas and types of every public request and response (DESIGN.md §7 documents each
one), imported by both the API and the website. Shapes only the API uses (buffered events, jobs,
the content file) stay in `apps/api/src/schema/`.

- Both apps import the built `dist/`, not `src/`: run `npm run build:shared` after a change (the
  root dev, test and typecheck scripts run it first; `npm run dev:shared` watches).
- **A change must work across a deploy**: the API is replaced before the website, so for a while
  old and new versions of the two read each other's answers (DESIGN.md §14.5, §15.6).
  - Add a field with a default (`.default(null)`, `.default([])`), so a website built with it
    still reads an older API's answer.
  - Remove a field in two releases: first the website stops reading it, then the API and this
    package drop it (expand → contract, as for migrations).
