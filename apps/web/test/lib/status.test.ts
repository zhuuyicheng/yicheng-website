import type { SystemStatus } from '@portfolio/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  appendSample,
  combineReplicas,
  fetchStatus,
  formatClock,
  formatMs,
  formatRatio,
  formatUptime,
  nearestPoint,
  niceCeiling,
  overallHealth,
  recordReplica,
  secondsAgo,
  timeLinePath,
  timeTicks,
  valueDepth,
} from '@/lib/status';

const STATUS: SystemStatus = {
  generatedAt: '2026-11-18T12:00:00.000Z',
  instance: 'api-1',
  uptimeSeconds: 3_720,
  dependencies: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
  http: { windowSeconds: 300, requestCount: 12, latencyMs: { p50: 3.1, p95: 18.4 } },
  cache: { hits: 9, misses: 1, hitRatio: 0.9 },
  analytics: { pageViewsLast24h: 41 },
  queues: {
    telemetryBuffer: 0,
    telemetryDeadLetter: 0,
    notificationsReady: 0,
    notificationsDelayed: 0,
    notificationsDeadLetter: 0,
  },
};

const respond = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('fetchStatus', () => {
  it('returns the status when it matches the shared contract', async () => {
    const fetch = respond(200, { data: STATUS });

    expect(await fetchStatus({ url: '/admin/system-status', fetch })).toEqual(STATUS);
    expect(fetch).toHaveBeenCalledWith('/admin/system-status', { cache: 'no-store' });
  });

  it('throws on an error status or an unexpected body, so the page shows "lost contact"', async () => {
    await expect(fetchStatus({ url: '/s', fetch: respond(503, {}) })).rejects.toThrow('503');
    await expect(
      fetchStatus({ url: '/s', fetch: respond(200, { data: { nope: 1 } }) }),
    ).rejects.toThrow('unexpected');
  });
});

describe('overallHealth', () => {
  it('is operational when every dependency is up, and names the ones that are down', () => {
    expect(overallHealth(STATUS)).toEqual({ level: 'operational', down: [] });
    const redisDown = {
      ...STATUS,
      dependencies: { ...STATUS.dependencies, redis: { status: 'down' as const, latencyMs: 2000 } },
    };
    expect(overallHealth(redisDown)).toEqual({ level: 'degraded', down: ['redis'] });
  });
});

describe('formatting', () => {
  it('shows uptime in its two largest units', () => {
    expect(formatUptime(42)).toBe('42s');
    expect(formatUptime(125)).toBe('2m 5s');
    expect(formatUptime(3_720)).toBe('1h 2m');
    expect(formatUptime(93_784)).toBe('1d 2h');
  });

  it('shows "—" for unknown values instead of a misleading 0', () => {
    expect(formatMs(null)).toBe('—');
    expect(formatMs(7.46)).toBe('7.5 ms');
    expect(formatMs(18.4)).toBe('18 ms');
    expect(formatRatio(null)).toBe('—');
    expect(formatRatio(0.968)).toBe('96.8 %');
  });

  it('counts seconds since the last update', () => {
    expect(secondsAgo(1_000, 4_400)).toBe(3);
  });
});

describe('combining the API replicas', () => {
  /** api-1's status above, or another replica's with some numbers changed. */
  function statusOf(
    instance: string,
    numbers: {
      uptime?: number;
      requests?: number;
      p50?: number | null;
      p95?: number | null;
      hits?: number;
      misses?: number;
    } = {},
  ): SystemStatus {
    return {
      ...STATUS,
      instance,
      uptimeSeconds: numbers.uptime ?? STATUS.uptimeSeconds,
      http: {
        ...STATUS.http,
        requestCount: numbers.requests ?? STATUS.http.requestCount,
        latencyMs: {
          p50: numbers.p50 === undefined ? STATUS.http.latencyMs.p50 : numbers.p50,
          p95: numbers.p95 === undefined ? STATUS.http.latencyMs.p95 : numbers.p95,
        },
      },
      cache: {
        hits: numbers.hits ?? STATUS.cache.hits,
        misses: numbers.misses ?? STATUS.cache.misses,
        hitRatio: null, // recomputed from the counts, never read
      },
    };
  }

  it('adds up requests and cache counts, and takes the slower latency', () => {
    // Regression: each poll showed one replica's numbers, so a quiet site's request chart
    // alternated between api-1's 1 and api-2's 0.
    let replicas = recordReplica({}, statusOf('api-1', { requests: 1, p50: 4, p95: 20 }), 0);
    replicas = recordReplica(
      replicas,
      statusOf('api-2', { requests: 0, p50: null, p95: null, hits: 3, misses: 3 }),
      5_000,
    );

    expect(combineReplicas(replicas)).toEqual({
      replicas: ['api-1', 'api-2'],
      uptimeSeconds: STATUS.uptimeSeconds,
      requestCount: 1,
      p50: 4, // api-2 answered nothing: its unknown latency is left out
      p95: 20,
      cacheHits: 12,
      cacheMisses: 4,
      hitRatio: 0.75,
    });

    // The next poll reaches api-1 again: the total stays steady instead of dropping to 0.
    replicas = recordReplica(replicas, statusOf('api-1', { requests: 1, p50: 6, p95: 9 }), 10_000);
    expect(combineReplicas(replicas)).toMatchObject({ requestCount: 1, p50: 6, p95: 9 });
  });

  it('keeps one reading per replica, the latest', () => {
    let replicas = recordReplica({}, statusOf('api-1', { requests: 5 }), 0);
    replicas = recordReplica(replicas, statusOf('api-1', { requests: 2 }), 5_000);

    expect(Object.keys(replicas)).toEqual(['api-1']);
    expect(combineReplicas(replicas)?.requestCount).toBe(2);
  });

  it('shows the most recent start as the uptime', () => {
    let replicas = recordReplica({}, statusOf('api-1', { uptime: 7_200 }), 0);
    replicas = recordReplica(replicas, statusOf('api-2', { uptime: 30 }), 5_000);

    expect(combineReplicas(replicas)?.uptimeSeconds).toBe(30);
  });

  it('forgets a replica that stopped answering', () => {
    let replicas = recordReplica({}, statusOf('api-1', { requests: 4 }), 0);
    replicas = recordReplica(replicas, statusOf('api-2', { requests: 3 }), 5_000);
    // api-1 is stopped: only api-2 answers from now on.
    replicas = recordReplica(replicas, statusOf('api-2', { requests: 3 }), 25_000);
    expect(combineReplicas(replicas)?.replicas).toEqual(['api-1', 'api-2']);

    replicas = recordReplica(replicas, statusOf('api-2', { requests: 3 }), 30_000);
    expect(combineReplicas(replicas)).toMatchObject({ replicas: ['api-2'], requestCount: 3 });
  });

  it('has nothing to show before the first reading', () => {
    expect(combineReplicas({})).toBeNull();
  });

  it('has no latency and no hit ratio while nothing was counted', () => {
    const replicas = recordReplica(
      {},
      statusOf('api-1', { requests: 0, p50: null, p95: null, hits: 0, misses: 0 }),
      0,
    );

    expect(combineReplicas(replicas)).toMatchObject({ p50: null, p95: null, hitRatio: null });
  });
});

describe('chart helpers', () => {
  it('keeps only the samples inside the time window', () => {
    const history = [1_000, 2_000, 3_000].map((at) => ({ at, p95: 1, requests: 1 }));

    const kept = appendSample(history, { at: 4_000, p95: 1, requests: 1 }, 2_500);

    expect(kept.map((sample) => sample.at)).toEqual([2_000, 3_000, 4_000]);
  });

  it('places ticks on whole multiples of the step, inside the axis', () => {
    const minute = 60_000;
    expect(timeTicks(2 * minute, 17 * minute, 5 * minute)).toEqual([
      5 * minute,
      10 * minute,
      15 * minute,
    ]);
    expect(timeTicks(1 * minute, 4 * minute, 5 * minute)).toEqual([]);
  });

  it('places points by time and breaks the line at unknown values and long gaps', () => {
    const scale = { start: 0, end: 100, width: 100, height: 50, ceiling: 10, maxGapMs: 20 };

    expect(
      timeLinePath(
        [
          { at: 0, value: 0 },
          { at: 10, value: 10 },
        ],
        scale,
      ),
    ).toBe('M0.0,50.0 L10.0,0.0');
    expect(
      timeLinePath(
        [
          { at: 0, value: 5 },
          { at: 10, value: null },
          { at: 20, value: 5 },
        ],
        scale,
      ),
    ).toBe('M0.0,25.0 M20.0,25.0');
    // 60 ms apart is a gap (the tab was hidden): two separate pieces.
    expect(
      timeLinePath(
        [
          { at: 0, value: 5 },
          { at: 60, value: 5 },
        ],
        scale,
      ),
    ).toBe('M0.0,25.0 M60.0,25.0');
    expect(timeLinePath([], scale)).toBe('');
  });

  it('puts the hover marker at the line’s height: zero on the axis, the ceiling at the top', () => {
    // Regression: the marker was placed in a box that also held the time labels, so a zero sat
    // below the axis. Both now use this fraction of the plot's height (live-chart.tsx).
    expect(valueDepth(0, 1)).toBe(1);
    expect(valueDepth(1, 1)).toBe(0);
    expect(valueDepth(5, 20)).toBe(0.75);
    expect(valueDepth(30, 20)).toBe(0); // above the scale: pinned to the top
    const scale = { start: 0, end: 10, width: 10, height: 80, ceiling: 20, maxGapMs: 1 };
    expect(timeLinePath([{ at: 0, value: 5 }], scale)).toBe(`M0.0,${(0.75 * 80).toFixed(1)}`);
  });

  it('finds the point nearest in time to the pointer', () => {
    const points = [
      { at: 0, value: 1 },
      { at: 10, value: 2 },
      { at: 20, value: 3 },
    ];
    expect(nearestPoint(points, 13)?.value).toBe(2);
    expect(nearestPoint([], 13)).toBeNull();
  });

  it('labels the axis with the 24-hour clock', () => {
    expect(formatClock(Date.UTC(2026, 10, 18, 9, 35))).toMatch(/^\d{2}:\d{2}$/);
  });

  it('rounds the scale up to a readable number', () => {
    expect(niceCeiling([3.2, 18.4])).toBe(20);
    expect(niceCeiling([120])).toBe(200);
    expect(niceCeiling([null])).toBe(1);
  });
});
