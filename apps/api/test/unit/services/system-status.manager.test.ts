import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../../src/infra/metrics.js';
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
    metrics,
    now: () => clock,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { manager, reads, metrics, advance };
}

describe('SystemStatusManager.getStatus', () => {
  it('assembles health, page views and queues: what the datastores say', async () => {
    const { manager } = setup();

    expect(await manager.getStatus(log)).toEqual({
      generatedAt: '2026-11-18T12:00:00.000Z',
      dependencies: HEALTHY.checks,
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
