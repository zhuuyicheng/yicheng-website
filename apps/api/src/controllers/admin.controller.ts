import type { FastifyInstance } from 'fastify';
import { requireBearerToken } from '../middleware/bearer-token.js';
import { visitorSummaryQuerySchema } from '../schema/visitor-insights.schema.js';
import type { SystemStatusManager } from '../services/system-status.manager.js';
import type { VisitorInsightsManager } from '../services/visitor-insights.manager.js';
import { renderSystemStatus } from '../views/system-status.view.js';
import { renderVisitorSummary } from '../views/visitor-insights.view.js';
import { API_V1 } from './api-v1.js';
import { parseRequest } from './parse-request.js';

export const ADMIN_SYSTEM_STATUS_PATH = `${API_V1}/admin/system-status`;
export const ADMIN_VISITORS_PATH = `${API_V1}/admin/visitors`;

/**
 * The owner's endpoints (DESIGN.md §7.7, §7.8), read by the web app's password-protected
 * /admin page. Every route needs `Authorization: Bearer <ADMIN_TOKEN>`; without the token
 * set, main wiring does not register them at all. Responses are never stored by caches.
 */
export function registerAdminController(
  app: FastifyInstance,
  managers: {
    systemStatusManager: Pick<SystemStatusManager, 'getStatus'>;
    visitorInsightsManager: VisitorInsightsManager;
  },
  options: { adminToken: string },
): void {
  const ownerOnly = { onRequest: [requireBearerToken(options.adminToken)] };

  /** Health, traffic, cache and queues. Always 200, even with a datastore down. */
  app.get(ADMIN_SYSTEM_STATUS_PATH, ownerOnly, async (request, reply) => {
    const status = await managers.systemStatusManager.getStatus(request.log);
    return reply.header('cache-control', 'no-store').send(renderSystemStatus(status));
  });

  /** Who visited, from where and how, over `?days=` (default 7). */
  app.get(ADMIN_VISITORS_PATH, ownerOnly, async (request, reply) => {
    const { days } = parseRequest(visitorSummaryQuerySchema, request.query);
    const summary = await managers.visitorInsightsManager.getSummary(days, request.log);
    return reply.header('cache-control', 'no-store').send(renderVisitorSummary(summary));
  });
}
