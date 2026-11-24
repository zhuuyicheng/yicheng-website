import type { SystemStatus } from '@portfolio/shared';
import { getSystemStatus } from './admin-api';
import { ApiUnavailableError } from './api';
import { prometheusUrl } from './config';
import { createPrometheusClient } from './prometheus';
import type { DashboardData } from './status';
import { readSystemMetrics, type SystemMetrics } from './system-metrics';

/** Where the dashboard's two halves come from; tests pass their own. */
export interface DashboardSources {
  status: () => Promise<SystemStatus>;
  metrics: () => Promise<SystemMetrics>;
}

const PRODUCTION_SOURCES: DashboardSources = {
  status: getSystemStatus,
  metrics: () =>
    readSystemMetrics(createPrometheusClient({ baseUrl: prometheusUrl(), fetch }), Date.now()),
};

/**
 * One poll of the /admin dashboard (DESIGN.md §15.5): the API's status and Prometheus's numbers,
 * asked side by side. Each failure becomes `null` plus a reason, so the page shows what it has
 * and says what's missing. Server only.
 */
export async function readDashboardData(
  sources: DashboardSources = PRODUCTION_SOURCES,
): Promise<DashboardData> {
  // Called inside the promise, so a throw (a malformed PROMETHEUS_URL) counts as a failure too.
  const [status, metrics] = await Promise.allSettled([
    Promise.resolve().then(sources.status),
    Promise.resolve().then(sources.metrics),
  ]);
  return {
    status: status.status === 'fulfilled' ? status.value : null,
    statusProblem: status.status === 'rejected' ? describeProblem(status.reason) : null,
    metrics: metrics.status === 'fulfilled' ? metrics.value : null,
    metricsProblem: metrics.status === 'rejected' ? describeProblem(metrics.reason) : null,
  };
}

/** A failure in a few words for the owner's banner: never a body, token or stack. */
export function describeProblem(error: unknown): string {
  // ApiUnavailableError wraps what happened; its own message just names the path.
  const cause = error instanceof ApiUnavailableError ? error.cause : error;
  if (!(cause instanceof Error)) return 'an unknown error';
  // By name: the shared package's schemas may throw another copy of Zod's error class.
  if (cause.name === 'ZodError') return 'an answer in an unexpected shape';
  if (cause.name === 'TimeoutError' || cause.name === 'AbortError') return 'no answer within 3 s';
  // Node's fetch says only "fetch failed"; the connection error is its cause.
  if (cause.message === 'fetch failed') return 'unreachable';
  return cause.message;
}
