import type { FastifyInstance } from 'fastify';
import type { HealthController } from '../controllers/health.controller.js';

/** URL → controller mapping for operational endpoints. */
export function registerHealthRoutes(app: FastifyInstance, controller: HealthController): void {
  app.get('/health', controller.getHealth);
}
