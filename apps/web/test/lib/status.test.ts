import type { SystemStatus } from '@portfolio/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  appendSample,
  fetchStatus,
  formatMs,
  formatRatio,
  formatUptime,
  linePath,
  niceCeiling,
  overallHealth,
  secondsAgo,
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

    expect(await fetchStatus({ baseUrl: 'http://api.test', fetch })).toEqual(STATUS);
    expect(fetch).toHaveBeenCalledWith('http://api.test/api/v1/system/status', {
      cache: 'no-store',
    });
  });

  it('throws on an error status or an unexpected body, so the page shows "lost contact"', async () => {
    await expect(fetchStatus({ baseUrl: '', fetch: respond(503, {}) })).rejects.toThrow('503');
    await expect(
      fetchStatus({ baseUrl: '', fetch: respond(200, { data: { nope: 1 } }) }),
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
  it('keeps only the newest samples', () => {
    const history = [1, 2, 3].map((at) => ({ at, p95: at, requests: at }));

    expect(appendSample(history, { at: 4, p95: 4, requests: 4 }, 3).map((s) => s.at)).toEqual([
      2, 3, 4,
    ]);
  });

  it('draws a line scaled to the ceiling, breaking at gaps instead of dropping to zero', () => {
    expect(linePath([0, 10], 100, 50, 10)).toBe('M0.0,50.0 L100.0,0.0');
    expect(linePath([5, null, 5], 100, 50, 10)).toBe('M0.0,25.0 M100.0,25.0');
    expect(linePath([], 100, 50, 10)).toBe('');
  });

  it('rounds the scale up to a readable number', () => {
    expect(niceCeiling([3.2, 18.4])).toBe(20);
    expect(niceCeiling([120])).toBe(200);
    expect(niceCeiling([null])).toBe(1);
  });
});
