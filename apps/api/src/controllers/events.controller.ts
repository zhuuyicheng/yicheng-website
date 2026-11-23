import type { FastifyInstance } from 'fastify';
import { eventRequestSchema } from '../schema/analytics-event.schema.js';
import type { TelemetryManager } from '../services/telemetry.manager.js';
import { renderEventAccepted } from '../views/telemetry.view.js';
import { API_V1 } from './api-v1.js';
import { jsonFromText, parseRequest } from './parse-request.js';

/** Telemetry ingestion (DESIGN.md §7.5). */
export function registerEventsController(
  app: FastifyInstance,
  telemetryManager: TelemetryManager,
): void {
  /**
   * 202: queued, not stored yet. Takes JSON as `application/json` or `text/plain`: the beacon
   * sends `text/plain`, which needs no CORS preflight (one request instead of two).
   */
  app.post(`${API_V1}/events`, async (request, reply) => {
    const event = parseRequest(eventRequestSchema, jsonFromText(request.body));
    const visitor = {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      acceptLanguage: request.headers['accept-language'] ?? '',
    };
    const accepted = await telemetryManager.ingest(event, visitor, request.log);
    return reply.status(202).send(renderEventAccepted(accepted));
  });
}
