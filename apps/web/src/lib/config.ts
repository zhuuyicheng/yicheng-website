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

/** One replica at its own address: `{ name: 'api-1', url: 'http://api-1:4000' }`. */
export interface ApiReplica {
  name: string;
  url: string;
}

/**
 * Every API replica (API_REPLICA_URLS), for the dashboard: each counts only its own requests,
 * and Caddy would reach one per poll (DESIGN.md §8.6). Unset: API_BASE_URL alone. Bad ones throw.
 */
export function apiReplicas(): ApiReplica[] {
  const listed = (process.env.API_REPLICA_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url !== '');
  const urls = listed.length > 0 ? listed : [serverApiBaseUrl()];
  const parsed = urls.map((url) => {
    // `new URL('api-1:4000')` parses (scheme `api-1:`), so check the result.
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

/** The /admin password and API bearer token (DESIGN.md §8.7). Server only; unset = no /admin. */
export function adminToken(): string | undefined {
  const token = process.env.ADMIN_TOKEN;
  return token === undefined || token === '' ? undefined : token;
}
