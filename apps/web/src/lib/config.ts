/**
 * Where the API lives. Two variables because two different computers call it:
 *
 *   - API_BASE_URL: used by the Next.js server when it renders a page. Read at request time,
 *     so it can differ per environment (in production: the API's internal address).
 *   - NEXT_PUBLIC_API_BASE_URL: used by visitors' browsers (page-view beacon, contact form).
 *     Next.js copies its value into the JavaScript bundle at build time (DESIGN.md §4), which
 *     is why it must be written out in full: `process.env[name]` would not be replaced.
 *
 * Both default to the local API, so `npm run dev:web` needs no configuration.
 */
const LOCAL_API = 'http://localhost:4000';

export function serverApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? LOCAL_API;
}

export const PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? LOCAL_API;
