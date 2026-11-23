import type { FastifyInstance } from 'fastify';
import { requireBearerToken } from '../middleware/bearer-token.js';
import type { MetricsTextManager } from '../services/metrics-text.manager.js';

export const METRICS_PATH = '/metrics';

/**
 * GET /metrics (DESIGN.md §7.7), in the API and the worker (§15.2). The JSON status report is in
 * admin.controller.ts.
 */
export function registerSystemController(
  app: FastifyInstance,
  metricsTextManager: MetricsTextManager,
  options: { metricsToken: string | null },
): void {
  /**
   * For Prometheus: plain text, no envelope. Optionally behind a bearer token, since it reveals
   * internals (route names, error counts). Read every 15 s, so it logs at `warn` only, like
   * /health; a wrong token still shows, as a failed scrape (`up` = 0).
   */
  const { metricsToken } = options;
  app.get(
    METRICS_PATH,
    {
      logLevel: 'warn',
      onRequest: metricsToken === null ? [] : [requireBearerToken(metricsToken)],
    },
    async (request, reply) => {
      const { contentType, body } = await metricsTextManager.getMetricsText(request.log);
      return reply.type(contentType).send(body);
    },
  );
}
