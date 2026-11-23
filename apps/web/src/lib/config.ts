/**
 * Where the API is. API_BASE_URL: for the Next.js server, read per request.
 * NEXT_PUBLIC_API_BASE_URL: for browsers, baked into the bundle at build time (DESIGN.md §4),
 * so it must be written out in full. Both default to the local API.
 */
const LOCAL_API = 'http://localhost:4000';

export function serverApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? LOCAL_API;
}

export const PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? LOCAL_API;

/** The development Prometheus of `npm run infra:up`. */
const LOCAL_PROMETHEUS = 'http://localhost:9090';

/**
 * Prometheus (PROMETHEUS_URL), for the /admin dashboard's numbers (DESIGN.md §15.5). Server only,
 * read per request. A malformed address throws: the dashboard then says why.
 */
export function prometheusUrl(): string {
  const configured = process.env.PROMETHEUS_URL;
  const url = configured === undefined || configured === '' ? LOCAL_PROMETHEUS : configured;
  // `new URL('prometheus:9090')` parses (scheme `prometheus:`), so check the result.
  const { protocol, hostname } = new URL(url);
  if ((protocol !== 'http:' && protocol !== 'https:') || hostname === '') {
    throw new Error(`PROMETHEUS_URL: "${url}" is not an http:// address`);
  }
  return url.replace(/\/+$/, '');
}

/** The /admin password and API bearer token (DESIGN.md §8.7). Server only; unset = no /admin. */
export function adminToken(): string | undefined {
  const token = process.env.ADMIN_TOKEN;
  return token === undefined || token === '' ? undefined : token;
}
