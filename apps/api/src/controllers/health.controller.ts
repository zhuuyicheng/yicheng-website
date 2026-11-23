import type { FastifyInstance } from 'fastify';
import type { LivenessReport } from '../schema/health.schema.js';
import type { HealthManager } from '../services/health.manager.js';

export const HEALTH_PATH = '/health';
export const LIVENESS_PATH = '/health/live';

const ALIVE: LivenessReport = { status: 'ok' };

/**
 * Health endpoints (DESIGN.md §7.3). Docker and Caddy poll them every few seconds, so they log
 * at `warn` only; a failing dependency is still logged.
 */
const QUIET = { logLevel: 'warn' } as const;

export function registerHealthController(app: FastifyInstance, healthManager: HealthManager): void {
  /** Readiness (deploys, smoke test): the bare report; 200 if every dependency is up, else 503. */
  app.get(HEALTH_PATH, QUIET, async (request, reply) => {
    const report = await healthManager.checkHealth(request.log);
    const statusCode = report.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(report);
  });

  /**
   * Liveness for Caddy (DESIGN.md §14.5): 200 whenever the process answers. It checks no
   * datastore on purpose: one down would fail every replica, and Caddy would drop them all.
   */
  app.get(LIVENESS_PATH, QUIET, () => ALIVE);
}
