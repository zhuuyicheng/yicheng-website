import { describe, expect, it } from 'vitest';
import type { InstantSample, PrometheusClient, RangeSeries } from '@/lib/prometheus';
import {
  CHART_STEP_SECONDS,
  CHART_WINDOW_MS,
  readSystemMetrics,
  SYSTEM_QUERIES,
} from '@/lib/system-metrics';

const NOW = Date.UTC(2026, 10, 24, 12, 0);

/** A Prometheus that knows the answer to each question, and records what it was asked. */
function fakePrometheus(
  instant: Record<string, InstantSample[]>,
  range: Record<string, RangeSeries[]> = {},
) {
  const windows: { expr: string; start: number; end: number; stepSeconds: number }[] = [];
  const prometheus: PrometheusClient = {
    instant: (expr) => Promise.resolve(instant[expr] ?? []),
    range: (expr, window) => {
      windows.push({ expr, ...window });
      return Promise.resolve(range[expr] ?? []);
    },
  };
  return { prometheus, windows };
}

const single = (value: number | null): InstantSample[] => [{ labels: {}, value }];
const up = (instance: string, job: string, value: number): InstantSample => ({
  labels: { instance, job },
  value,
});

describe('readSystemMetrics', () => {
  it('turns the answers into the tiles: milliseconds, and the cache misses and ratio', async () => {
    const { prometheus } = fakePrometheus({
      [SYSTEM_QUERIES.requests]: single(12.4),
      [SYSTEM_QUERIES.p50]: single(0.25),
      [SYSTEM_QUERIES.p95]: single(0.5),
      [SYSTEM_QUERIES.cacheHits]: single(9),
      [SYSTEM_QUERIES.cacheLookups]: single(12),
      [SYSTEM_QUERIES.uptime]: single(3_720),
    });

    expect(await readSystemMetrics(prometheus, NOW)).toMatchObject({
      requests: 12.4,
      p50Ms: 250,
      p95Ms: 500,
      cacheHits: 9,
      cacheMisses: 3,
      hitRatio: 0.75,
      uptimeSeconds: 3_720,
    });
  });

  it('names every process Prometheus reads, and which did not answer, by name', async () => {
    const { prometheus } = fakePrometheus({
      [SYSTEM_QUERIES.up]: [
        up('worker', 'worker', 1),
        up('api-2', 'api', 0),
        up('api-1', 'api', 1),
        up('node-exporter', 'node', 1),
      ],
    });

    expect((await readSystemMetrics(prometheus, NOW)).targets).toEqual([
      { name: 'api-1', job: 'api', up: true },
      { name: 'api-2', job: 'api', up: false },
      { name: 'node-exporter', job: 'node', up: true },
      { name: 'worker', job: 'worker', up: true },
    ]);
  });

  it('has nothing to show, rather than made-up numbers, when nothing was counted', async () => {
    const { prometheus } = fakePrometheus({
      [SYSTEM_QUERIES.p50]: single(null), // NaN: no requests in 5 minutes
    });

    expect(await readSystemMetrics(prometheus, NOW)).toEqual({
      requests: 0,
      p50Ms: null,
      p95Ms: null,
      cacheHits: 0,
      cacheMisses: 0,
      hitRatio: null,
      uptimeSeconds: null,
      targets: [],
      charts: { requests: [], p95Ms: [] },
    });
  });

  it('draws the charts from the last 30 minutes, a point every 15 s, latency in ms', async () => {
    const points = (values: (number | null)[]) =>
      values.map((value, index) => ({ at: NOW - (values.length - 1 - index) * 15_000, value }));
    const { prometheus, windows } = fakePrometheus(
      {},
      {
        [SYSTEM_QUERIES.requests]: [{ labels: {}, points: points([3, 4]) }],
        [SYSTEM_QUERIES.p95]: [{ labels: {}, points: points([0.5, null]) }],
      },
    );

    const { charts } = await readSystemMetrics(prometheus, NOW);

    expect(charts.requests).toEqual(points([3, 4]));
    expect(charts.p95Ms).toEqual(points([500, null]));
    expect(windows).toEqual([
      expect.objectContaining({ start: NOW - CHART_WINDOW_MS, end: NOW, stepSeconds: 15 }),
      expect.objectContaining({ start: NOW - CHART_WINDOW_MS, end: NOW, stepSeconds: 15 }),
    ]);
    expect(CHART_STEP_SECONDS).toBe(15);
  });

  it('counts visitor requests only: the health checks, Prometheus and /admin are left out', () => {
    const visitorsOnly = 'job="api", route!~"/health|/health/live|/metrics|/api/v1/admin/.*"';
    for (const expr of [SYSTEM_QUERIES.requests, SYSTEM_QUERIES.p50, SYSTEM_QUERIES.p95]) {
      expect(expr).toContain(visitorsOnly);
    }
  });
});
