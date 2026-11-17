import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HealthService } from '../services/health.service.js';

export interface HealthController {
  getHealth: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
}

export function createHealthController(healthService: HealthService): HealthController {
  return {
    /**
     * Readiness check for load balancers and orchestrators. Sends the report itself (no
     * `{ data }` envelope): 200 when every dependency is up, otherwise 503.
     */
    async getHealth(request, reply) {
      const report = await healthService.checkHealth(request.log);
      const statusCode = report.status === 'ok' ? 200 : 503;
      return reply.status(statusCode).send(report);
    },
  };
}
