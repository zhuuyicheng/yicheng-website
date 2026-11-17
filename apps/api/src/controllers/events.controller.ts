import type { FastifyInstance } from 'fastify';
import { eventRequestSchema } from '../schema/analytics-event.schema.js';
import type { TelemetryManager } from '../services/telemetry.manager.js';
import { renderEventAccepted } from '../views/telemetry.view.js';
import { API_V1 } from './api-v1.js';
import { parseRequest } from './parse-request.js';

/** Telemetry ingestion. See DESIGN.md §7.5. */
export function registerEventsController(
  app: FastifyInstance,
  telemetryManager: TelemetryManager,
): void {
  /**
   * 202 Accepted, not 201 Created: the event is queued, not yet stored. The worker writes
   * it to Postgres a moment later.
   */
  app.post(`${API_V1}/events`, async (request, reply) => {
    const event = parseRequest(eventRequestSchema, request.body);
    const visitor = { ip: request.ip, userAgent: request.headers['user-agent'] ?? '' };
    const accepted = await telemetryManager.ingest(event, visitor, request.log);
    return reply.status(202).send(renderEventAccepted(accepted));
  });
}
