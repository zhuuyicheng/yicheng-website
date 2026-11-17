import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { createHealthController } from './controllers/health.controller.js';
import type { Logger } from './infra/logger.js';
import { pingPostgres, type PostgresPool } from './infra/postgres.js';
import { pingRedis, type Redis } from './infra/redis.js';
import { registerErrorHandlers } from './middleware/error-handler.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './middleware/request-id.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { createHealthService } from './services/health.service.js';

/** Infrastructure created by the composition root (main.ts, or a test) and shared by modules. */
export interface AppDependencies {
  logger: Logger;
  postgres: PostgresPool;
  redis: Redis;
}

const BODY_LIMIT_BYTES = 16 * 1024;

/**
 * Builds a fully wired Fastify instance without listening on a port. That lets tests call
 * `app.inject()` against the exact same app that production runs.
 */
export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({
    loggerInstance: dependencies.logger,
    genReqId: resolveRequestId,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    bodyLimit: BODY_LIMIT_BYTES,
  });

  // Set early so the header is present on every response, errors included.
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  registerErrorHandlers(app);

  // Wiring: service (business logic) → controller (HTTP in/out) → routes (URL table).
  const healthService = createHealthService([
    { name: 'postgres', ping: () => pingPostgres(dependencies.postgres) },
    { name: 'redis', ping: () => pingRedis(dependencies.redis) },
  ]);
  registerHealthRoutes(app, createHealthController(healthService));

  return app;
}
