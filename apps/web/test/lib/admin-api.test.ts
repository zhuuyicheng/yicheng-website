import type { SystemStatus } from '@portfolio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSystemStatus } from '@/lib/admin-api';
import { ApiUnavailableError } from '@/lib/api';

const STATUS: SystemStatus = {
  generatedAt: '2026-11-24T12:00:00.000Z',
  dependencies: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
  analytics: { pageViewsLast24h: 2 },
  queues: null,
};

/** What the release before sent: the per-process numbers too (DESIGN.md §15.6). */
const PREVIOUS_RELEASE = {
  ...STATUS,
  instance: 'api-1',
  uptimeSeconds: 60,
  http: { windowSeconds: 300, requestCount: 4, latencyMs: { p50: 3, p95: 9 } },
  cache: { hits: 1, misses: 1, hitRatio: 0.5 },
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
    expect(status).toEqual(STATUS);
  });

  it("still reads the previous release's answer during a rolling deploy, minus its extras", async () => {
    vi.stubEnv('ADMIN_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ data: PREVIOUS_RELEASE }))),
    );

    expect(await getSystemStatus()).toEqual(STATUS);
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
