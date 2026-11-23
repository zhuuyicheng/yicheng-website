import { z } from 'zod';
import type { PrometheusClient } from './prometheus';

/**
 * The /admin dashboard's per-process numbers, from Prometheus (DESIGN.md §15.5): both API
 * replicas at once, so the page no longer asks each one and adds them up.
 */

/** Visitor requests: the monitors (health checks, Prometheus, /admin's own calls) left out. */
const VISITOR = 'job="api", route!~"/health|/health/live|/metrics|/api/v1/admin/.*"';

function latencyQuantile(quantile: number): string {
  return `histogram_quantile(${String(quantile)}, sum by (le) (rate(http_request_duration_seconds_bucket{${VISITOR}}[5m])))`;
}

/** `or vector(0)`: no series yet (nothing counted since a fresh start) is 0, not unknown. */
export const SYSTEM_QUERIES = {
  requests: `sum(increase(http_requests_total{${VISITOR}}[5m])) or vector(0)`,
  p50: latencyQuantile(0.5),
  p95: latencyQuantile(0.95),
  cacheHits: 'sum(increase(cache_requests_total{job="api", result="hit"}[24h])) or vector(0)',
  cacheLookups: 'sum(increase(cache_requests_total{job="api"}[24h])) or vector(0)',
  uptime: 'time() - max(process_start_time_seconds{job="api"})',
  up: 'up',
} as const;

/** The charts: the last 30 minutes, a point every 15 s (Prometheus's own pace). */
export const CHART_WINDOW_MS = 30 * 60_000;
export const CHART_STEP_SECONDS = 15;

const timePointSchema = z.object({ at: z.number(), value: z.number().nullable() });

/** What the dashboard's route sends the browser: web-internal, not the API's contract. */
export const systemMetricsSchema = z.object({
  /** Visitor requests in the last 5 minutes. Estimated from samples, so not always whole. */
  requests: z.number(),
  /** Milliseconds; `null` with no requests in the last 5 minutes. */
  p50Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
  /** Content cache lookups in the last 24 hours. */
  cacheHits: z.number(),
  cacheMisses: z.number(),
  /** hits ÷ lookups; `null` with none. */
  hitRatio: z.number().nullable(),
  /** Since the most recently started API replica; `null` when none is known. */
  uptimeSeconds: z.number().nullable(),
  /** Every process Prometheus reads, and whether it answered the last time. */
  targets: z.array(z.object({ name: z.string(), job: z.string(), up: z.boolean() })),
  charts: z.object({ requests: z.array(timePointSchema), p95Ms: z.array(timePointSchema) }),
});
export type SystemMetrics = z.infer<typeof systemMetricsSchema>;

/** Every question at once; one that fails fails the lot (the page then says why). */
export async function readSystemMetrics(
  prometheus: PrometheusClient,
  now: number,
): Promise<SystemMetrics> {
  const single = async (expr: string) => (await prometheus.instant(expr))[0]?.value ?? null;
  const chart = async (expr: string) =>
    (
      await prometheus.range(expr, {
        start: now - CHART_WINDOW_MS,
        end: now,
        stepSeconds: CHART_STEP_SECONDS,
      })
    )[0]?.points ?? [];
  const toMs = (seconds: number | null) => (seconds === null ? null : seconds * 1000);

  const [requests, p50, p95, hits, lookups, uptime, up, requestsChart, p95Chart] =
    await Promise.all([
      single(SYSTEM_QUERIES.requests),
      single(SYSTEM_QUERIES.p50),
      single(SYSTEM_QUERIES.p95),
      single(SYSTEM_QUERIES.cacheHits),
      single(SYSTEM_QUERIES.cacheLookups),
      single(SYSTEM_QUERIES.uptime),
      prometheus.instant(SYSTEM_QUERIES.up),
      chart(SYSTEM_QUERIES.requests),
      chart(SYSTEM_QUERIES.p95),
    ]);

  const cacheHits = hits ?? 0;
  const cacheLookups = lookups ?? 0;
  return {
    requests: requests ?? 0,
    p50Ms: toMs(p50),
    p95Ms: toMs(p95),
    cacheHits,
    cacheMisses: Math.max(0, cacheLookups - cacheHits),
    hitRatio: cacheLookups > 0 ? cacheHits / cacheLookups : null,
    uptimeSeconds: uptime,
    targets: up
      .map((sample) => ({
        name: sample.labels.instance ?? 'unknown',
        job: sample.labels.job ?? 'unknown',
        up: sample.value === 1,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    charts: {
      requests: requestsChart,
      p95Ms: p95Chart.map((point) => ({ at: point.at, value: toMs(point.value) })),
    },
  };
}
