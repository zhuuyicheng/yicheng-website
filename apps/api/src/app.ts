import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/env.js';
import { registerContentController } from './controllers/content.controller.js';
import { registerEventsController } from './controllers/events.controller.js';
import { registerHealthController } from './controllers/health.controller.js';
import { createContentCacheDal } from './dal/content-cache.dal.js';
import { createContentDal } from './dal/content.dal.js';
import { createEventBufferDal } from './dal/event-buffer.dal.js';
import { createTelemetrySaltDal } from './dal/telemetry-salt.dal.js';
import type { Logger } from './infra/logger.js';
import type { Metrics } from './infra/metrics.js';
import { pingPostgres, type PostgresPool } from './infra/postgres.js';
import { pingRedis, type Redis } from './infra/redis.js';
import { registerErrorHandlers } from './middleware/error-handler.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './middleware/request-id.js';
import { createCacheAsideManager } from './services/cache-aside.manager.js';
import { createContentManager } from './services/content.manager.js';
import { createHealthManager } from './services/health.manager.js';
import { createTelemetryManager } from './services/telemetry.manager.js';

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
    // Behind a proxy (Caddy), every request comes from the proxy's IP. Trusting it makes
    // `request.ip` the visitor's IP from X-Forwarded-For. Never enable without a proxy:
    // anyone could then fake their IP with that header.
    trustProxy: config.server.trustProxy,
  });

  // Set early so the header is present on every response, errors included.
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  registerErrorHandlers(app);

  // Wiring, one module at a time:
  // DAL (data access) → manager (business rules) → controller (endpoints).

  const healthManager = createHealthManager([
    { name: 'postgres', ping: () => pingPostgres(postgres) },
    { name: 'redis', ping: () => pingRedis(redis) },
  ]);
  registerHealthController(app, healthManager);

  const contentCacheDal = createContentCacheDal(redis);
  const contentManager = createContentManager({
    dal: createContentDal(postgres),
    cacheDal: contentCacheDal,
    cache: createCacheAsideManager({
      cacheDal: contentCacheDal,
      metrics,
      ttlSeconds: config.cache.ttlSeconds,
    }),
  });
  registerContentController(app, contentManager);

  const telemetryManager = createTelemetryManager({
    bufferDal: createEventBufferDal(redis),
    saltDal: createTelemetrySaltDal(redis),
    metrics,
    bufferMaxLength: config.telemetry.bufferMaxLength,
  });
  registerEventsController(app, telemetryManager);

  return app;
}
