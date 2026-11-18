import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../../src/infra/metrics.js';
import { createRollingLatency } from '../../../src/infra/rolling-latency.js';
import type { HealthReport } from '../../../src/schema/health.schema.js';
import type { QueueDepths } from '../../../src/schema/system-status.schema.js';
import { createSystemStatusManager } from '../../../src/services/system-status.manager.js';
import { counterValue } from '../../helpers/metrics.js';

const log = pino({ level: 'silent' });
const OUTAGE = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
const DEPTHS: QueueDepths = {
  telemetryBuffer: 3,
  telemetryDeadLetter: 0,
  notificationsReady: 1,
  notificationsDelayed: 2,
  notificationsDeadLetter: 0,
};
const HEALTHY: HealthReport = {
  status: 'ok',
  checks: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
};

function setup(options: { queuesFail?: boolean; pageViewsFail?: boolean } = {}) {
  let clock = Date.parse('2026-11-18T12:00:00.000Z');
  const reads = { health: 0, queues: 0, pageViews: 0 };
  const metrics = createMetrics();
  const latency = createRollingLatency({ now: () => clock });
  const manager = createSystemStatusManager({
    healthManager: {
      checkHealth: () => {
        reads.health += 1;
        return Promise.resolve(HEALTHY);
      },
    },
    queueDepthDal: {
      readDepths: () => {
        reads.queues += 1;
        return options.queuesFail ? Promise.reject(OUTAGE) : Promise.resolve(DEPTHS);
      },
    },
    analyticsEventDal: {
      countPageViews: () => {
        reads.pageViews += 1;
        return options.pageViewsFail ? Promise.reject(OUTAGE) : Promise.resolve(412);
      },
    },
    latency,
    metrics,
    instance: 'api-1',
    now: () => clock,
    uptimeSeconds: () => 86_400.7,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { manager, reads, metrics, latency, advance };
}

describe('SystemStatusManager.getStatus', () => {
  it('assembles health, latency, cache, page views and queues', async () => {
    const { manager, metrics, latency } = setup();
    for (const ms of [2, 4, 6, 8]) latency.record(ms);
    metrics.cacheRequests.inc({ cache: 'projects', result: 'hit' }, 3);
    metrics.cacheRequests.inc({ cache: 'profile', result: 'miss' });

    expect(await manager.getStatus(log)).toEqual({
      generatedAt: '2026-11-18T12:00:00.000Z',
      instance: 'api-1',
      uptimeSeconds: 86_400,
      dependencies: HEALTHY.checks,
      http: { windowSeconds: 300, requestCount: 4, latencyMs: { p50: 4, p95: 8 } },
      cache: { hits: 3, misses: 1, hitRatio: 0.75 },
      analytics: { pageViewsLast24h: 412 },
      queues: DEPTHS,
    });
  });

  it('serves the same status for 5 s, then refreshes', async () => {
    const { manager, reads, advance } = setup();

    const first = await manager.getStatus(log);
    advance(4_999);
    expect(await manager.getStatus(log)).toBe(first);
    expect(reads.health).toBe(1);

    advance(1);
    const refreshed = await manager.getStatus(log);
    expect(refreshed.generatedAt).not.toBe(first.generatedAt);
    expect(reads.health).toBe(2);
  });

  it('shares one refresh between simultaneous requests', async () => {
    const { manager, reads } = setup();

    await Promise.all([manager.getStatus(log), manager.getStatus(log), manager.getStatus(log)]);

    expect(reads).toEqual({ health: 1, queues: 1, pageViews: 1 });
  });

  it('leaves out what it cannot read (null), counts it, and still answers', async () => {
    const { manager, metrics } = setup({ queuesFail: true, pageViewsFail: true });

    const status = await manager.getStatus(log);

    expect(status.queues).toBeNull();
    expect(status.analytics.pageViewsLast24h).toBeNull();
    expect(await counterValue(metrics.observabilityReadErrors, { source: 'queue_depths' })).toBe(1);
    expect(await counterValue(metrics.observabilityReadErrors, { source: 'page_views' })).toBe(1);
  });

  it('reports no hit ratio before the first cache lookup (not 0, not NaN)', async () => {
    const { manager } = setup();

    expect((await manager.getStatus(log)).cache).toEqual({ hits: 0, misses: 0, hitRatio: null });
  });
});

describe('SystemStatusManager.getMetricsText', () => {
  it('refreshes the queue gauges, then renders the Prometheus text', async () => {
    const { manager } = setup();

    const { contentType, body } = await manager.getMetricsText(log);

    expect(contentType).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(body).toContain('queue_depth{queue="telemetry_buffer"} 3');
    expect(body).toContain('queue_depth{queue="notifications_delayed"} 2');
  });

  it('drops the gauge samples when Redis is down: unknown, not zero', async () => {
    const { manager } = setup({ queuesFail: true });

    const { body } = await manager.getMetricsText(log);

    expect(body).not.toMatch(/^queue_depth\{/m);
    expect(body).toContain('observability_read_errors_total{source="queue_depths"} 1');
  });
});
