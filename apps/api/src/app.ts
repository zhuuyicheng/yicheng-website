import { hostname } from 'node:os';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/env.js';
import {
  ADMIN_QUEUE_ITEMS_PATH,
  ADMIN_SYSTEM_STATUS_PATH,
  ADMIN_VISITORS_PATH,
  registerAdminController,
} from './controllers/admin.controller.js';
import { registerContactController } from './controllers/contact.controller.js';
import { registerContentController } from './controllers/content.controller.js';
import { registerEventsController } from './controllers/events.controller.js';
import {
  HEALTH_PATH,
  LIVENESS_PATH,
  registerHealthController,
} from './controllers/health.controller.js';
import { METRICS_PATH, registerSystemController } from './controllers/system.controller.js';
import { createAnalyticsEventDal } from './dal/analytics-event.dal.js';
import { createContactMessageDal } from './dal/contact-message.dal.js';
import { createContentCacheDal } from './dal/content-cache.dal.js';
import { createContentDal } from './dal/content.dal.js';
import { createEventBufferDal } from './dal/event-buffer.dal.js';
import { createIpLocationDal, type IpDatabases } from './dal/ip-location.dal.js';
import { createNotificationQueueDal } from './dal/notification-queue.dal.js';
import { createQueueDepthDal } from './dal/queue-depth.dal.js';
import { createRateLimitDal } from './dal/rate-limit.dal.js';
import { createTelemetrySaltDal } from './dal/telemetry-salt.dal.js';
import { createVisitorInsightsDal } from './dal/visitor-insights.dal.js';
import { createIpHasher } from './infra/ip-hash.js';
import type { Logger } from './infra/logger.js';
import type { Metrics } from './infra/metrics.js';
import { pingPostgres, type PostgresPool } from './infra/postgres.js';
import { pingRedis, type Redis } from './infra/redis.js';
import { createRollingLatency } from './infra/rolling-latency.js';
import { registerErrorHandlers } from './middleware/error-handler.js';
import { registerHttpMetrics } from './middleware/http-metrics.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './middleware/request-id.js';
import { registerSecurityPlugins } from './middleware/security.js';
import { createCacheAsideManager } from './services/cache-aside.manager.js';
import { createContactManager } from './services/contact.manager.js';
import { createContentManager } from './services/content.manager.js';
import { createHealthManager } from './services/health.manager.js';
import { createQueueItemsManager } from './services/queue-items.manager.js';
import { createRateLimiterManager } from './services/rate-limiter.manager.js';
import { createSystemStatusManager } from './services/system-status.manager.js';
import { createTelemetryManager } from './services/telemetry.manager.js';
import { createVisitorDetailsManager } from './services/visitor-details.manager.js';
import { createVisitorInsightsManager } from './services/visitor-insights.manager.js';

/** Infra clients built by main.ts (or a test), shared by every module. */
export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  postgres: PostgresPool;
  redis: Redis;
  /** Opened at startup by infra/ip-databases.ts; tests usually pass NO_IP_DATABASES. */
  ipDatabases: IpDatabases;
}

const BODY_LIMIT_BYTES = 16 * 1024;

/** The fully wired app, not listening: tests `inject()` into exactly what production runs. */
export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const { config, logger, metrics, postgres, redis, ipDatabases } = dependencies;

  const app = Fastify({
    loggerInstance: logger,
    genReqId: resolveRequestId,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    bodyLimit: BODY_LIMIT_BYTES,
    // Behind Caddy, `request.ip` comes from X-Forwarded-For. Never without a proxy: anyone
    // could fake their IP with that header.
    trustProxy: config.server.trustProxy,
  });

  // Set early so the header is present on every response, errors included.
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  registerErrorHandlers(app);
  registerSecurityPlugins(app, { corsOrigins: config.cors.origins });
  const latency = createRollingLatency();
  registerHttpMetrics(app, {
    metrics,
    latency,
    // Not visitor traffic, so kept out of p95.
    latencyIgnoredRoutes: [
      HEALTH_PATH,
      LIVENESS_PATH,
      METRICS_PATH,
      ADMIN_SYSTEM_STATUS_PATH,
      ADMIN_VISITORS_PATH,
      ADMIN_QUEUE_ITEMS_PATH,
    ],
  });

  // Wiring: DAL (data access) → manager (business rules) → controller (endpoints).

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

  const eventBufferDal = createEventBufferDal(redis);
  const telemetryManager = createTelemetryManager({
    bufferDal: eventBufferDal,
    saltDal: createTelemetrySaltDal(redis),
    visitorDetails: createVisitorDetailsManager({
      ipLocationDal: createIpLocationDal(ipDatabases),
    }),
    metrics,
    bufferMaxLength: config.telemetry.bufferMaxLength,
  });
  registerEventsController(app, telemetryManager);

  const hashIp = createIpHasher(config.ipHash.secret);
  const contactRateLimiter = createRateLimiterManager({
    limiter: 'contact',
    rateLimitDal: createRateLimitDal(redis),
    hashIp,
    metrics,
    max: config.contact.rateLimitMax,
    windowSeconds: config.contact.rateLimitWindowSeconds,
  });
  const contactMessageDal = createContactMessageDal(postgres);
  const notificationQueueDal = createNotificationQueueDal(redis);
  const contactManager = createContactManager({
    contactMessageDal,
    notificationQueueDal,
    hashIp,
    metrics,
  });
  registerContactController(app, contactManager, contactRateLimiter);

  const systemStatusManager = createSystemStatusManager({
    healthManager,
    queueDepthDal: createQueueDepthDal(redis),
    analyticsEventDal: createAnalyticsEventDal(postgres),
    latency,
    metrics,
    instance: hostname(),
  });
  registerSystemController(app, systemStatusManager, { metricsToken: config.metrics.token });

  // The owner's endpoints exist only when ADMIN_TOKEN is set (DESIGN.md §7.8).
  if (config.admin.token === null) {
    logger.info({ routes: '/api/v1/admin/*' }, 'owner endpoints disabled: ADMIN_TOKEN not set');
  } else {
    const visitorInsightsManager = createVisitorInsightsManager({
      insightsDal: createVisitorInsightsDal(postgres),
    });
    const queueItemsManager = createQueueItemsManager({
      bufferDal: eventBufferDal,
      queueDal: notificationQueueDal,
      contactMessageDal,
    });
    registerAdminController(
      app,
      { systemStatusManager, visitorInsightsManager, queueItemsManager },
      { adminToken: config.admin.token },
    );
  }

  return app;
}
