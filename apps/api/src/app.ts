import { hostname } from 'node:os';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/env.js';
import {
  ADMIN_SYSTEM_STATUS_PATH,
  ADMIN_VISITORS_PATH,
  registerAdminController,
} from './controllers/admin.controller.js';
import { registerContactController } from './controllers/contact.controller.js';
import { registerContentController } from './controllers/content.controller.js';
import { registerEventsController } from './controllers/events.controller.js';
import { registerHealthController } from './controllers/health.controller.js';
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
import { createRateLimiterManager } from './services/rate-limiter.manager.js';
import { createSystemStatusManager } from './services/system-status.manager.js';
import { createTelemetryManager } from './services/telemetry.manager.js';
import { createVisitorDetailsManager } from './services/visitor-details.manager.js';
import { createVisitorInsightsManager } from './services/visitor-insights.manager.js';

/** Infrastructure created by the composition root (main.ts, or a test) and shared by modules. */
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

/**
 * Builds a fully wired Fastify instance without listening on a port. That lets tests call
 * `app.inject()` against the exact same app that production runs.
 */
export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const { config, logger, metrics, postgres, redis, ipDatabases } = dependencies;

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
  registerSecurityPlugins(app, { corsOrigins: config.cors.origins });
  const latency = createRollingLatency();
  registerHttpMetrics(app, {
    metrics,
    latency,
    // Monitoring and the owner's pages: neither is visitor traffic, so neither skews p95.
    latencyIgnoredRoutes: ['/health', METRICS_PATH, ADMIN_SYSTEM_STATUS_PATH, ADMIN_VISITORS_PATH],
  });

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
  const contactManager = createContactManager({
    contactMessageDal: createContactMessageDal(postgres),
    notificationQueueDal: createNotificationQueueDal(redis),
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
    registerAdminController(
      app,
      { systemStatusManager, visitorInsightsManager },
      { adminToken: config.admin.token },
    );
  }

  return app;
}
