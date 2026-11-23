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

/** One API replica, at its own address: `{ name: 'api-1', url: 'http://api-1:4000' }`. */
export interface ApiReplica {
  name: string;
  url: string;
}

/**
 * Every API replica, from API_REPLICA_URLS (comma-separated), for the live dashboard. Each
 * replica counts only the requests it answered, so the dashboard asks every one directly:
 * through the load balancer (API_BASE_URL) it would reach only one per poll (DESIGN.md §8.6).
 * Unset: API_BASE_URL alone, the one API of `npm run dev:api`. A malformed address throws.
 */
export function apiReplicas(): ApiReplica[] {
  const listed = (process.env.API_REPLICA_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url !== '');
  const urls = listed.length > 0 ? listed : [serverApiBaseUrl()];
  const parsed = urls.map((url) => {
    // `new URL('api-1:4000')` parses (as the scheme `api-1:`), so check what it parsed to.
    const { protocol, hostname, host } = new URL(url);
    if ((protocol !== 'http:' && protocol !== 'https:') || hostname === '') {
      throw new Error(`API_REPLICA_URLS: "${url}" is not an http:// address`);
    }
    return { hostname, host, url: url.replace(/\/+$/, '') };
  });
  // `api-1`, or `localhost:4001` when two replicas share a host (two local APIs).
  const shared = (hostname: string) => parsed.filter((p) => p.hostname === hostname).length > 1;
  return parsed.map((p) => ({ name: shared(p.hostname) ? p.host : p.hostname, url: p.url }));
}

/**
 * The owner's password for /admin, also sent to the API as its bearer token (DESIGN.md §8.7).
 * Server only: it has no NEXT_PUBLIC_ prefix, so it never reaches the browser bundle. Read per
 * request; unset or empty turns the owner area off.
 */
export function adminToken(): string | undefined {
  const token = process.env.ADMIN_TOKEN;
  return token === undefined || token === '' ? undefined : token;
}
