import type { FastifyInstance } from 'fastify';
import type { HealthManager } from '../services/health.manager.js';

/** Operational endpoints. */
export function registerHealthController(app: FastifyInstance, healthManager: HealthManager): void {
  /**
   * Readiness check for load balancers and orchestrators. Sends the report itself (no
   * `{ data }` envelope): 200 when every dependency is up, otherwise 503.
   */
  app.get('/health', async (request, reply) => {
    const report = await healthManager.checkHealth(request.log);
    const statusCode = report.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(report);
  });
}
