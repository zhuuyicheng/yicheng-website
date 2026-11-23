import type { AnalyticsEventDal } from '../dal/analytics-event.dal.js';
import type { QueueDepthDal } from '../dal/queue-depth.dal.js';
import type { Logger } from '../infra/logger.js';
import type { Metrics, ObservabilitySource } from '../infra/metrics.js';
import type { RollingLatency } from '../infra/rolling-latency.js';
import { withTimeout } from '../infra/with-timeout.js';
import type { QueueDepths, SystemStatus } from '../schema/system-status.schema.js';
import type { HealthManager } from './health.manager.js';

const READ_TIMEOUT_MS = 2_000;

/** The Prometheus text and its content-type header. */
export interface MetricsText {
  contentType: string;
  body: string;
}

/**
 * The system's report on itself (DESIGN.md §7.7, §8.5): JSON for /admin, Prometheus text for
 * a scraper. A source that fails is left out and counted, so the dashboard still works during
 * an outage, when you need it most.
 */
export interface SystemStatusManager {
  /** Cached for 5 s in-process: any number of viewers cost one refresh per 5 s. */
  getStatus: (log: Logger) => Promise<SystemStatus>;
  /** Refreshes the queue gauges, then renders every metric. */
  getMetricsText: (log: Logger) => Promise<MetricsText>;
}

export interface SystemStatusManagerDependencies {
  healthManager: Pick<HealthManager, 'checkHealth'>;
  queueDepthDal: QueueDepthDal;
  analyticsEventDal: Pick<AnalyticsEventDal, 'countPageViews'>;
  latency: RollingLatency;
  metrics: Metrics;
  /** The hostname: the container name once deployed. */
  instance: string;
  cacheTtlMs?: number;
  /** For tests. */
  now?: () => number;
  uptimeSeconds?: () => number;
}

export function createSystemStatusManager(
  deps: SystemStatusManagerDependencies,
): SystemStatusManager {
  const { healthManager, queueDepthDal, analyticsEventDal, latency, metrics, instance } = deps;
  const { cacheTtlMs = 5_000, now = Date.now, uptimeSeconds = () => process.uptime() } = deps;

  let cached: { at: number; status: SystemStatus } | null = null;
  // Concurrent requests share one refresh (single-flight).
  let refreshing: Promise<SystemStatus> | null = null;

  /** On failure: log, count and return `null` instead of failing the page. */
  async function orNull<T>(source: ObservabilitySource, read: () => Promise<T>, log: Logger) {
    try {
      return await withTimeout(read(), READ_TIMEOUT_MS, source);
    } catch (error) {
      metrics.observabilityReadErrors.inc({ source });
      log.warn({ err: error, source }, 'status source unavailable, left out');
      return null;
    }
  }

  async function cacheCounts(): Promise<SystemStatus['cache']> {
    const { values } = await metrics.cacheRequests.get();
    const count = (result: string) =>
      values
        .filter((sample) => sample.labels.result === result)
        .reduce((sum, s) => sum + s.value, 0);
    const hits = count('hit');
    const misses = count('miss');
    const total = hits + misses;
    return {
      hits,
      misses,
      hitRatio: total === 0 ? null : Math.round((hits / total) * 1000) / 1000,
    };
  }

  async function buildStatus(log: Logger): Promise<SystemStatus> {
    // Independent, so they run at once.
    const [health, queues, pageViews, cache] = await Promise.all([
      healthManager.checkHealth(log),
      orNull('queue_depths', () => queueDepthDal.readDepths(), log),
      orNull('page_views', () => analyticsEventDal.countPageViews(24), log),
      cacheCounts(),
    ]);
    const http = latency.snapshot();

    return {
      generatedAt: new Date(now()).toISOString(),
      instance,
      uptimeSeconds: Math.floor(uptimeSeconds()),
      dependencies: health.checks,
      http: {
        windowSeconds: http.windowSeconds,
        requestCount: http.requestCount,
        latencyMs: { p50: http.p50, p95: http.p95 },
      },
      cache,
      analytics: { pageViewsLast24h: pageViews },
      queues,
    };
  }

  function setQueueGauges(depths: QueueDepths | null): void {
    if (depths === null) {
      // Unknown isn't zero: no sample shows as a gap, not a false "empty".
      metrics.queueDepth.reset();
      return;
    }
    metrics.queueDepth.set({ queue: 'telemetry_buffer' }, depths.telemetryBuffer);
    metrics.queueDepth.set({ queue: 'telemetry_dlq' }, depths.telemetryDeadLetter);
    metrics.queueDepth.set({ queue: 'notifications_ready' }, depths.notificationsReady);
    metrics.queueDepth.set({ queue: 'notifications_delayed' }, depths.notificationsDelayed);
    metrics.queueDepth.set({ queue: 'notifications_dlq' }, depths.notificationsDeadLetter);
  }

  return {
    async getStatus(log) {
      if (cached !== null && now() - cached.at < cacheTtlMs) {
        return cached.status;
      }
      refreshing ??= buildStatus(log)
        .then((status) => {
          cached = { at: now(), status };
          return status;
        })
        .finally(() => {
          refreshing = null;
        });
      return refreshing;
    },

    async getMetricsText(log) {
      setQueueGauges(await orNull('queue_depths', () => queueDepthDal.readDepths(), log));
      return { contentType: metrics.registry.contentType, body: await metrics.registry.metrics() };
    },
  };
}
