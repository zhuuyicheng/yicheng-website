import type { DependencyHealth } from '../schema/health.schema.js';
import type { SystemStatus } from '../schema/system-status.schema.js';
import type { DataResponseBody } from './data.view.js';

// Copied field by field: a new status field only reaches the dashboard once it's added here.

export function renderSystemStatus(status: SystemStatus): DataResponseBody<SystemStatus> {
  return {
    data: {
      generatedAt: status.generatedAt,
      instance: status.instance,
      uptimeSeconds: status.uptimeSeconds,
      dependencies: Object.fromEntries(
        Object.entries(status.dependencies).map(([name, health]) => [name, toDependency(health)]),
      ),
      http: {
        windowSeconds: status.http.windowSeconds,
        requestCount: status.http.requestCount,
        latencyMs: { p50: status.http.latencyMs.p50, p95: status.http.latencyMs.p95 },
      },
      cache: {
        hits: status.cache.hits,
        misses: status.cache.misses,
        hitRatio: status.cache.hitRatio,
      },
      analytics: { pageViewsLast24h: status.analytics.pageViewsLast24h },
      queues: status.queues && {
        telemetryBuffer: status.queues.telemetryBuffer,
        telemetryDeadLetter: status.queues.telemetryDeadLetter,
        notificationsReady: status.queues.notificationsReady,
        notificationsDelayed: status.queues.notificationsDelayed,
        notificationsDeadLetter: status.queues.notificationsDeadLetter,
      },
    },
  };
}

function toDependency(health: DependencyHealth): DependencyHealth {
  return { status: health.status, latencyMs: health.latencyMs };
}
