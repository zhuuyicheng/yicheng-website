import type { SystemStatus } from '@portfolio/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchDashboard,
  formatClock,
  formatMs,
  formatRatio,
  formatUptime,
  nearestPoint,
  niceCeiling,
  overallHealth,
  secondsAgo,
  timeLinePath,
  timeTicks,
  valueDepth,
  type DashboardData,
  type DashboardStatus,
} from '@/lib/status';
import type { SystemMetrics } from '@/lib/system-metrics';

const STATUS: DashboardStatus = {
  generatedAt: '2026-11-24T12:00:00.000Z',
  dependencies: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
  analytics: { pageViewsLast24h: 41 },
  queues: {
    telemetryBuffer: 0,
    telemetryDeadLetter: 0,
    notificationsReady: 0,
    notificationsDelayed: 0,
    notificationsDeadLetter: 0,
  },
};

const METRICS: SystemMetrics = {
  requests: 12,
  p50Ms: 3.1,
  p95Ms: 18.4,
  cacheHits: 9,
  cacheMisses: 1,
  hitRatio: 0.9,
  uptimeSeconds: 3_720,
  targets: [
    { name: 'api-1', job: 'api', up: true },
    { name: 'api-2', job: 'api', up: true },
    { name: 'worker', job: 'worker', up: true },
  ],
  charts: { requests: [{ at: 1_000, value: 12 }], p95Ms: [{ at: 1_000, value: null }] },
};

const DATA: DashboardData = {
  status: STATUS,
  statusProblem: null,
  metrics: METRICS,
  metricsProblem: null,
};

const respond = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('fetchDashboard', () => {
  it('returns one poll, checked against its schema', async () => {
    const fetch = respond(200, { data: DATA });

    expect(await fetchDashboard({ url: '/admin/system-status', fetch })).toEqual(DATA);
    expect(fetch).toHaveBeenCalledWith('/admin/system-status', { cache: 'no-store' });
  });

  it("takes the API's status with or without its per-process numbers, and drops them", async () => {
    // The API sends them until the next release (DESIGN.md §15.6); Prometheus has them now.
    const old: SystemStatus = {
      ...STATUS,
      instance: 'api-1',
      uptimeSeconds: 60,
      http: { windowSeconds: 300, requestCount: 4, latencyMs: { p50: 3, p95: 9 } },
      cache: { hits: 1, misses: 1, hitRatio: 0.5 },
    };
    const fetch = respond(200, { data: { ...DATA, status: old } });

    expect((await fetchDashboard({ url: '/s', fetch })).status).toEqual(STATUS);
  });

  it('throws on an error status or an unexpected body, so the page says so', async () => {
    await expect(fetchDashboard({ url: '/s', fetch: respond(503, {}) })).rejects.toThrow('503');
    for (const data of [STATUS, { ...DATA, metrics: { requests: 'many' } }, { replicas: [] }]) {
      await expect(fetchDashboard({ url: '/s', fetch: respond(200, { data }) })).rejects.toThrow(
        'unexpected',
      );
    }
  });
});

describe('overallHealth', () => {
  it('is operational when the API answers with every dependency up, and every process answers', () => {
    expect(overallHealth(DATA)).toEqual({ level: 'operational', problems: [] });
  });

  it('is degraded with a dependency down or a process not answering, naming them', () => {
    const redisDown: DashboardData = {
      ...DATA,
      status: {
        ...STATUS,
        dependencies: { ...STATUS.dependencies, redis: { status: 'down', latencyMs: 2000 } },
      },
    };
    expect(overallHealth(redisDown)).toEqual({ level: 'degraded', problems: ['redis is down'] });

    const silent = (...names: string[]): DashboardData => ({
      ...DATA,
      metrics: {
        ...METRICS,
        targets: METRICS.targets.map((target) => ({ ...target, up: !names.includes(target.name) })),
      },
    });
    expect(overallHealth(silent('worker')).problems).toEqual(['worker is not answering']);
    expect(overallHealth(silent('api-1', 'api-2')).problems).toEqual([
      'api-1, api-2 are not answering',
    ]);
  });

  it('is degraded when Prometheus does not answer, saying why the numbers are missing', () => {
    const health = overallHealth({ ...DATA, metrics: null, metricsProblem: 'unreachable' });

    expect(health).toEqual({
      level: 'degraded',
      problems: ['Prometheus is not answering (unreachable): no traffic numbers'],
    });
  });

  it('is down when the API does not answer, and says why', () => {
    const health = overallHealth({ ...DATA, status: null, statusProblem: 'HTTP 503' });

    expect(health).toEqual({ level: 'down', problems: ['the API is not answering (HTTP 503)'] });
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

describe('chart helpers', () => {
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
    // 60 ms apart is a gap (hidden tab): two pieces.
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
    // Regression: the marker's box also held the time labels, so a zero sat below the axis.
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
