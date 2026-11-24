import type { SystemStatus } from '@portfolio/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiUnavailableError } from '@/lib/api';
import { describeProblem, readDashboardData } from '@/lib/dashboard-data';
import type { SystemMetrics } from '@/lib/system-metrics';

const STATUS: SystemStatus = {
  generatedAt: '2026-11-24T12:00:00.000Z',
  dependencies: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
  analytics: { pageViewsLast24h: 2 },
  queues: null,
};

const METRICS: SystemMetrics = {
  requests: 4,
  p50Ms: 3,
  p95Ms: 9,
  cacheHits: 1,
  cacheMisses: 1,
  hitRatio: 0.5,
  uptimeSeconds: 60,
  targets: [{ name: 'api-1', job: 'api', up: true }],
  charts: { requests: [], p95Ms: [] },
};

describe('readDashboardData', () => {
  it('passes both halves on when both answer', async () => {
    const data = await readDashboardData({
      status: () => Promise.resolve(STATUS),
      metrics: () => Promise.resolve(METRICS),
    });

    expect(data).toEqual({
      status: STATUS,
      statusProblem: null,
      metrics: METRICS,
      metricsProblem: null,
    });
  });

  it('keeps one half when the other fails, and says why', async () => {
    const withoutPrometheus = await readDashboardData({
      status: () => Promise.resolve(STATUS),
      metrics: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect(withoutPrometheus).toMatchObject({ status: STATUS, metrics: null });
    expect(withoutPrometheus.metricsProblem).toBe('unreachable');

    const withoutApi = await readDashboardData({
      status: () => Promise.reject(new ApiUnavailableError('/s', new Error('HTTP 503'))),
      metrics: () => Promise.resolve(METRICS),
    });
    expect(withoutApi).toMatchObject({ status: null, statusProblem: 'HTTP 503', metrics: METRICS });
  });

  it('counts a throw before any request (a malformed PROMETHEUS_URL) as a failure too', async () => {
    const data = await readDashboardData({
      status: () => Promise.resolve(STATUS),
      metrics: () => {
        throw new Error('PROMETHEUS_URL: "x" is not an http:// address');
      },
    });

    expect(data.metricsProblem).toBe('PROMETHEUS_URL: "x" is not an http:// address');
  });
});

describe('describeProblem', () => {
  it('says what went wrong in a few words', () => {
    const timedOut = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const zodError = z.string().safeParse(1).error;

    expect(describeProblem(new ApiUnavailableError('/s', new Error('HTTP 503')))).toBe('HTTP 503');
    expect(describeProblem(new ApiUnavailableError('/s', new TypeError('fetch failed')))).toBe(
      'unreachable',
    );
    expect(describeProblem(timedOut)).toBe('no answer within 3 s');
    expect(describeProblem(zodError)).toBe('an answer in an unexpected shape');
    expect(describeProblem('not an error')).toBe('an unknown error');
  });
});
