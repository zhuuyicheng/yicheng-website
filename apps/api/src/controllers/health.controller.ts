import type { FastifyInstance } from 'fastify';
import type { LivenessReport } from '../schema/health.schema.js';
import type { HealthManager } from '../services/health.manager.js';

export const HEALTH_PATH = '/health';
export const LIVENESS_PATH = '/health/live';

const ALIVE: LivenessReport = { status: 'ok' };

/** Operational endpoints (DESIGN.md §7.3). */
export function registerHealthController(app: FastifyInstance, healthManager: HealthManager): void {
  /**
   * Readiness check for deploys, monitoring and the smoke test. Sends the report itself (no
   * `{ data }` envelope): 200 when every dependency is up, otherwise 503.
   */
  app.get(HEALTH_PATH, async (request, reply) => {
    const report = await healthManager.checkHealth(request.log);
    const statusCode = report.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(report);
  });

  /**
   * Liveness check for the load balancer (DESIGN.md §14.5): 200 whenever this process can
   * answer. It calls no manager on purpose: Postgres or Redis being down affects every replica
   * alike, so a check that looked at them would make Caddy drop all replicas at once and turn
   * a degraded site into a full outage.
   *
   * `logLevel: 'warn'`: Caddy asks every 5 s per replica, and Fastify's two info lines per
   * request ("incoming request", "request completed") would bury the logs that matter.
   */
  app.get(LIVENESS_PATH, { logLevel: 'warn' }, () => ALIVE);
}
