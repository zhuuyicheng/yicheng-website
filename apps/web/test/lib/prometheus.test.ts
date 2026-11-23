import { describe, expect, it, vi } from 'vitest';
import { createPrometheusClient } from '@/lib/prometheus';

/** A fetch that answers `body` with `status`, recording the URLs it was asked. */
function answering(body: unknown, status = 200) {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(Response.json(body, { status })),
  );
}

describe('createPrometheusClient', () => {
  it('asks /api/v1/query and reads each series; NaN and +Inf become unknown', async () => {
    const fetch = answering({
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { instance: 'api-1', job: 'api' }, value: [1795450000, '1'] },
          { metric: { instance: 'api-2', job: 'api' }, value: [1795450000, 'NaN'] },
          { metric: {}, value: [1795450000, '+Inf'] },
        ],
      },
    });
    const prometheus = createPrometheusClient({ baseUrl: 'http://prometheus:9090', fetch });

    expect(await prometheus.instant('up')).toEqual([
      { labels: { instance: 'api-1', job: 'api' }, value: 1 },
      { labels: { instance: 'api-2', job: 'api' }, value: null },
      { labels: {}, value: null },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'http://prometheus:9090/api/v1/query?query=up',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) as unknown }),
    );
  });

  it('asks /api/v1/query_range in seconds and returns the points in milliseconds', async () => {
    const fetch = answering({
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: {},
            values: [
              [1000, '2'],
              [1015, 'NaN'],
            ],
          },
        ],
      },
    });
    const prometheus = createPrometheusClient({ baseUrl: 'http://prometheus:9090', fetch });

    const series = await prometheus.range('sum(up)', {
      start: 1_000_000,
      end: 1_015_000,
      stepSeconds: 15,
    });

    expect(series).toEqual([
      {
        labels: {},
        points: [
          { at: 1_000_000, value: 2 },
          { at: 1_015_000, value: null },
        ],
      },
    ]);
    const url = new URL(fetch.mock.calls[0]?.[0] as string); // the client passes a string
    expect(url.pathname).toBe('/api/v1/query_range');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'sum(up)',
      start: '1000',
      end: '1015',
      step: '15',
    });
  });

  it("throws with Prometheus's own reason for a refused query, else the status code", async () => {
    const refused = answering(
      { status: 'error', errorType: 'bad_data', error: 'parse error' },
      400,
    );
    await expect(
      createPrometheusClient({ baseUrl: 'http://p', fetch: refused }).instant('sum('),
    ).rejects.toThrow('Prometheus refused the query: parse error');

    const down = vi.fn(() => Promise.resolve(new Response('Service Unavailable', { status: 503 })));
    await expect(
      createPrometheusClient({ baseUrl: 'http://p', fetch: down }).instant('up'),
    ).rejects.toThrow('Prometheus answered HTTP 503');
  });

  it('gives up after its time limit instead of waiting', async () => {
    const hanging = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );
    const prometheus = createPrometheusClient({
      baseUrl: 'http://p',
      fetch: hanging,
      timeoutMs: 20,
    });

    await expect(prometheus.instant('up')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
