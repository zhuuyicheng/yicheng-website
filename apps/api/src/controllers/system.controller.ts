import type { FastifyInstance } from 'fastify';
import { requireBearerToken } from '../middleware/bearer-token.js';
import type { SystemStatusManager } from '../services/system-status.manager.js';

export const METRICS_PATH = '/metrics';

/** GET /metrics (DESIGN.md §7.7). The JSON status report is in admin.controller.ts. */
export function registerSystemController(
  app: FastifyInstance,
  systemStatusManager: Pick<SystemStatusManager, 'getMetricsText'>,
  options: { metricsToken: string | null },
): void {
  /**
   * For Prometheus: plain text, no envelope. Optionally behind a bearer token, since it reveals
   * internals (route names, error counts).
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
