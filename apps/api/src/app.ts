import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/env.js';
import { createContentController } from './controllers/content.controller.js';
import { createHealthController } from './controllers/health.controller.js';
import type { Logger } from './infra/logger.js';
import type { Metrics } from './infra/metrics.js';
import { pingPostgres, type PostgresPool } from './infra/postgres.js';
import { pingRedis, type Redis } from './infra/redis.js';
import { registerErrorHandlers } from './middleware/error-handler.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './middleware/request-id.js';
import { createContentCacheStore } from './repositories/content-cache.store.js';
import { createContentRepository } from './repositories/content.repository.js';
import { registerContentRoutes } from './routes/content.routes.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { createCacheAside } from './services/cache-aside.js';
import { createContentService } from './services/content.service.js';
import { createHealthService } from './services/health.service.js';

/** Infrastructure created by the composition root (main.ts, or a test) and shared by modules. */
export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  postgres: PostgresPool;
  redis: Redis;
}

const BODY_LIMIT_BYTES = 16 * 1024;

/**
 * Builds a fully wired Fastify instance without listening on a port. That lets tests call
 * `app.inject()` against the exact same app that production runs.
 */
export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const { config, logger, metrics, postgres, redis } = dependencies;

  const app = Fastify({
    loggerInstance: logger,
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

  // Wiring, one module at a time:
  // repositories (data access) → service (business rules) → controller (HTTP) → routes (URLs).

  const healthService = createHealthService([
    { name: 'postgres', ping: () => pingPostgres(postgres) },
    { name: 'redis', ping: () => pingRedis(redis) },
  ]);
  registerHealthRoutes(app, createHealthController(healthService));

  const contentCacheStore = createContentCacheStore(redis);
  const contentService = createContentService({
    repository: createContentRepository(postgres),
    cacheStore: contentCacheStore,
    cache: createCacheAside({
      store: contentCacheStore,
      metrics,
      ttlSeconds: config.cache.ttlSeconds,
    }),
  });
  registerContentRoutes(app, createContentController(contentService));

  return app;
}
