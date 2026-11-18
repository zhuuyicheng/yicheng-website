import type { FastifyInstance } from 'fastify';
import { requireBearerToken } from '../middleware/bearer-token.js';
import type { SystemStatusManager } from '../services/system-status.manager.js';
import { renderSystemStatus } from '../views/system-status.view.js';
import { API_V1 } from './api-v1.js';

export const METRICS_PATH = '/metrics';
export const SYSTEM_STATUS_PATH = `${API_V1}/system/status`;

/** Observability endpoints. See DESIGN.md §7.7. */
export function registerSystemController(
  app: FastifyInstance,
  systemStatusManager: SystemStatusManager,
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

  /** For the public dashboard: counts and timings only. Always 200, even with a datastore down. */
  app.get(SYSTEM_STATUS_PATH, async (request, reply) => {
    const status = await systemStatusManager.getStatus(request.log);
    return reply.send(renderSystemStatus(status));
  });
}
