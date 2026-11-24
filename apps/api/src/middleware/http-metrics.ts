import type { FastifyInstance } from 'fastify';
import type { Metrics } from '../infra/metrics.js';

/**
 * Times every response (DESIGN.md §8.5) for Prometheus. `route` is the template
 * (`/projects/:slug`), never the URL, or random URLs would create unbounded series. Monitors are
 * counted too; PromQL leaves them out where it matters (§15.2).
 */
export function registerHttpMetrics(app: FastifyInstance, metrics: Metrics): void {
  // After the response is sent, so measuring costs the client nothing.
  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const labels = { method: request.method, route, status_code: String(reply.statusCode) };
    metrics.httpRequests.inc(labels);
    // ms since Fastify received the request
    metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    done();
  });
}
