import { performance } from 'node:perf_hooks';
import type { Logger } from '../infra/logger.js';
import { withTimeout } from '../infra/with-timeout.js';
import type { DependencyCheck, DependencyHealth, HealthReport } from '../models/health.model.js';

export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export interface HealthService {
  /** `log` is the caller's (request-scoped) logger, so failures carry the requestId. */
  checkHealth: (log: Logger) => Promise<HealthReport>;
}

export function createHealthService(dependencies: readonly DependencyCheck[]): HealthService {
  return {
    async checkHealth(log) {
      const results = await Promise.all(
        dependencies.map(async (dependency) => {
          const health = await probe(dependency, log);
          return [dependency.name, health] as const;
        }),
      );

      const allUp = results.every(([, health]) => health.status === 'up');
      return {
        status: allUp ? 'ok' : 'degraded',
        checks: Object.fromEntries(results),
      };
    },
  };
}

async function probe(dependency: DependencyCheck, log: Logger): Promise<DependencyHealth> {
  const startedAt = performance.now();

  try {
    await withTimeout(dependency.ping(), HEALTH_CHECK_TIMEOUT_MS, `${dependency.name} ping`);
    return { status: 'up', latencyMs: elapsedMs(startedAt) };
  } catch (err) {
    // The reason is logged but not returned: error messages can contain hostnames.
    log.warn({ err, dependency: dependency.name }, 'dependency health check failed');
    return { status: 'down', latencyMs: elapsedMs(startedAt) };
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
