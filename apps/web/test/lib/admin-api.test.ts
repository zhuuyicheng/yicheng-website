import type { SystemStatus } from '@portfolio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSystemStatus } from '@/lib/admin-api';
import { ApiUnavailableError } from '@/lib/api';

/** What the API sends until the next release: the per-process numbers too (DESIGN.md §15.6). */
const STATUS: SystemStatus = {
  generatedAt: '2026-11-24T12:00:00.000Z',
  instance: 'api-1',
  uptimeSeconds: 60,
  dependencies: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
  http: { windowSeconds: 300, requestCount: 4, latencyMs: { p50: 3, p95: 9 } },
  cache: { hits: 1, misses: 1, hitRatio: 0.5 },
  analytics: { pageViewsLast24h: 2 },
  queues: null,
};

/** What the dashboard keeps: the rest come from Prometheus. */
const SHARED = {
  generatedAt: STATUS.generatedAt,
  dependencies: STATUS.dependencies,
  analytics: STATUS.analytics,
  queues: STATUS.queues,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getSystemStatus', () => {
  it('asks the API once, through API_BASE_URL, with the token and a time limit', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'token');
    vi.stubEnv('API_BASE_URL', 'http://caddy:8080');
    const fetch = vi.fn((_url: string) => Promise.resolve(Response.json({ data: STATUS })));
    vi.stubGlobal('fetch', fetch);

    const status = await getSystemStatus();

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://caddy:8080/api/v1/admin/system-status',
    ]);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer token' }) as unknown,
        signal: expect.any(AbortSignal) as unknown,
      }),
    );
    // Dependencies, queues and page views; the per-process numbers are dropped.
    expect(status).toEqual(SHARED);
  });

  it('accepts a status without the per-process numbers, as the next release sends', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ data: SHARED }))),
    );

    expect(await getSystemStatus()).toEqual(SHARED);
  });

  it('throws when the API fails, so the dashboard can say why', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 503 }))),
    );

    await expect(getSystemStatus()).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
