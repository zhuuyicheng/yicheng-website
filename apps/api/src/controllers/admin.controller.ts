import type { FastifyInstance } from 'fastify';
import { requireBearerToken } from '../middleware/bearer-token.js';
import { queueItemsParamsSchema, queueItemsQuerySchema } from '../schema/queue-items.schema.js';
import { visitorSummaryQuerySchema } from '../schema/visitor-insights.schema.js';
import type { QueueItemsManager } from '../services/queue-items.manager.js';
import type { SystemStatusManager } from '../services/system-status.manager.js';
import type { VisitorInsightsManager } from '../services/visitor-insights.manager.js';
import { renderQueueItems } from '../views/queue-items.view.js';
import { renderSystemStatus } from '../views/system-status.view.js';
import { renderVisitorSummary } from '../views/visitor-insights.view.js';
import { API_V1 } from './api-v1.js';
import { parseRequest } from './parse-request.js';

export const ADMIN_SYSTEM_STATUS_PATH = `${API_V1}/admin/system-status`;
export const ADMIN_VISITORS_PATH = `${API_V1}/admin/visitors`;
export const ADMIN_QUEUE_ITEMS_PATH = `${API_V1}/admin/queues/:queue`;

/**
 * The owner's endpoints (DESIGN.md §7.7, §7.8), for /admin. They need the ADMIN_TOKEN bearer
 * token and exist only when it's set. Never cached.
 */
export function registerAdminController(
  app: FastifyInstance,
  managers: {
    systemStatusManager: Pick<SystemStatusManager, 'getStatus'>;
    visitorInsightsManager: VisitorInsightsManager;
    queueItemsManager: QueueItemsManager;
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

  /** What waits in one queue (`?limit=`, default 20), newest first. Takes nothing out. */
  app.get(ADMIN_QUEUE_ITEMS_PATH, ownerOnly, async (request, reply) => {
    const { queue } = parseRequest(queueItemsParamsSchema, request.params);
    const { limit } = parseRequest(queueItemsQuerySchema, request.query);
    const items = await managers.queueItemsManager.getItems(queue, limit, request.log);
    return reply.header('cache-control', 'no-store').send(renderQueueItems(items));
  });
}
