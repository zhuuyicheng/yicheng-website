import type { FastifyInstance } from 'fastify';
import type { Metrics } from '../infra/metrics.js';
import type { RollingLatency } from '../infra/rolling-latency.js';

export interface HttpMetricsOptions {
  metrics: Metrics;
  latency: RollingLatency;
  /**
   * Routes left out of the rolling latency (the dashboard's p50/p95), though Prometheus still
   * counts them: the monitors' own requests. A dashboard polling every few seconds would
   * otherwise mostly measure itself.
   */
  latencyIgnoredRoutes: readonly string[];
}

/**
 * Times every response (DESIGN.md §8.5): `http_request_duration_seconds` and
 * `http_requests_total`, plus the rolling window behind the system status endpoint.
 *
 * `route` is the route *template* (`/api/v1/projects/:slug`), never the URL: every distinct
 * label value is a separate time series in Prometheus, so `/projects/a`, `/projects/b`, …
 * (or a bot trying random URLs) would create unbounded series. Unknown URLs are `unmatched`.
 */
export function registerHttpMetrics(app: FastifyInstance, options: HttpMetricsOptions): void {
  const { metrics, latency } = options;
  const ignored = new Set(options.latencyIgnoredRoutes);

  // onResponse runs after the response was sent, so measuring costs the client nothing.
  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const labels = { method: request.method, route, status_code: String(reply.statusCode) };
    metrics.httpRequests.inc(labels);
    // elapsedTime: ms since Fastify received the request, with sub-millisecond precision.
    metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    if (!ignored.has(route)) {
      latency.record(reply.elapsedTime);
    }
    done();
  });
}
