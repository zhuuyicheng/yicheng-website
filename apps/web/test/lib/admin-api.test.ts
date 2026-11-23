import type { SystemStatus } from '@portfolio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getReplicaStatuses } from '@/lib/admin-api';

const STATUS: SystemStatus = {
  generatedAt: '2026-11-23T12:00:00.000Z',
  instance: 'api-1',
  uptimeSeconds: 60,
  dependencies: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
  http: { windowSeconds: 300, requestCount: 4, latencyMs: { p50: 3, p95: 9 } },
  cache: { hits: 1, misses: 1, hitRatio: 0.5 },
  analytics: { pageViewsLast24h: 2 },
  queues: null,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getReplicaStatuses', () => {
  it('asks every replica at its own address, with the token and a time limit', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'token');
    vi.stubEnv('API_REPLICA_URLS', 'http://api-1:4000,http://api-2:4000');
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        Response.json({ data: { ...STATUS, instance: new URL(url).hostname } }, { status: 200 }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    const { replicas } = await getReplicaStatuses();

    expect(replicas.map((replica) => [replica.name, replica.status?.instance])).toEqual([
      ['api-1', 'api-1'],
      ['api-2', 'api-2'],
    ]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://api-1:4000/api/v1/admin/system-status',
      'http://api-2:4000/api/v1/admin/system-status',
    ]);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer token' }) as unknown,
        signal: expect.any(AbortSignal) as unknown,
      }),
    );
  });

  it('lists a replica that fails as silent, and still returns the others', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'token');
    vi.stubEnv('API_REPLICA_URLS', 'http://api-1:4000,http://api-2:4000,http://api-3:4000');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('http://api-1')) return Promise.reject(new TypeError('fetch failed'));
        if (url.startsWith('http://api-2'))
          return Promise.resolve(new Response('', { status: 503 }));
        return Promise.resolve(Response.json({ data: STATUS }));
      }),
    );

    const { replicas } = await getReplicaStatuses();

    expect(replicas.map((replica) => [replica.name, replica.status !== null])).toEqual([
      ['api-1', false],
      ['api-2', false],
      ['api-3', true],
    ]);
  });
});
