import type { FastifyInstance } from 'fastify';
import type { Metrics } from '../infra/metrics.js';
import type { RollingLatency } from '../infra/rolling-latency.js';

export interface HttpMetricsOptions {
  metrics: Metrics;
  latency: RollingLatency;
  /** Kept out of the dashboard's p50/p95 (still in Prometheus): monitors measuring themselves. */
  latencyIgnoredRoutes: readonly string[];
}

/**
 * Times every response (DESIGN.md §8.5) for Prometheus and the rolling window. `route` is the
 * template (`/projects/:slug`), never the URL, or random URLs would create unbounded series.
 */
export function registerHttpMetrics(app: FastifyInstance, options: HttpMetricsOptions): void {
  const { metrics, latency } = options;
  const ignored = new Set(options.latencyIgnoredRoutes);

  // After the response is sent, so measuring costs the client nothing.
  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const labels = { method: request.method, route, status_code: String(reply.statusCode) };
    metrics.httpRequests.inc(labels);
    // ms since Fastify received the request
    metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    if (!ignored.has(route)) {
      latency.record(reply.elapsedTime);
    }
    done();
  });
}
