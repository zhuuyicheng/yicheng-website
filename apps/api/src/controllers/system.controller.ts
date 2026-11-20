import type { FastifyInstance } from 'fastify';
import { requireBearerToken } from '../middleware/bearer-token.js';
import type { SystemStatusManager } from '../services/system-status.manager.js';

export const METRICS_PATH = '/metrics';

/**
 * The metrics endpoint for a monitoring server. See DESIGN.md §7.7. The JSON status report
 * for people is owner-only: controllers/admin.controller.ts.
 */
export function registerSystemController(
  app: FastifyInstance,
  systemStatusManager: Pick<SystemStatusManager, 'getMetricsText'>,
  options: { metricsToken: string | null },
): void {
  /**
   * For Prometheus (unversioned, like /health: machines read it, not the web app). Plain text
   * in Prometheus' format, no `{ data }` envelope. Optionally behind a bearer token, because it
   * reveals internals (route names, error counts) that are nobody else's business.
   */
  const { metricsToken } = options;
  app.get(
    METRICS_PATH,
    { onRequest: metricsToken === null ? [] : [requireBearerToken(metricsToken)] },
    async (request, reply) => {
      const { contentType, body } = await systemStatusManager.getMetricsText(request.log);
      return reply.type(contentType).send(body);
    },
  );
}
