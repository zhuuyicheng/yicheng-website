import type { SystemStatus } from '@portfolio/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  appendSample,
  fetchStatus,
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
