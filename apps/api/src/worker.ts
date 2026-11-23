/**
 * Worker entrypoint (composition root): background work that must never slow a request
 * (telemetry flusher, contact notifications). Run exactly one (DESIGN.md §8.4).
 */
import { loadConfigOrExit } from './config/env.js';
import { createAnalyticsEventDal } from './dal/analytics-event.dal.js';
import { createContactMessageDal } from './dal/contact-message.dal.js';
import { createEventBufferDal } from './dal/event-buffer.dal.js';
import { createNotificationQueueDal } from './dal/notification-queue.dal.js';
import { createLogger } from './infra/logger.js';
import { createMetrics } from './infra/metrics.js';
import { createNotifier } from './infra/notifiers/create-notifier.js';
import { createPostgresPool, pingPostgres } from './infra/postgres.js';
import {
  closeInterruptedRedis,
  closeRedis,
  connectRedis,
  createRedisClient,
} from './infra/redis.js';
import { createGracefulShutdown, registerProcessHandlers } from './lifecycle/graceful-shutdown.js';
import { createNotificationManager } from './services/notification.manager.js';
import { createTelemetryFlushManager } from './services/telemetry-flush.manager.js';
import { createNotificationConsumer } from './workers/notification-consumer.worker.js';
import { createPeriodicWorker } from './workers/periodic.worker.js';
import { createTelemetryFlusher } from './workers/telemetry-flusher.worker.js';

/** Kept from the shutdown deadline for closing connections after draining. */
const CLOSE_CONNECTIONS_RESERVE_MS = 1_000;
const PROMOTER_INTERVAL_MS = 1_000;
const RECONCILER_INTERVAL_MS = 60_000;

const config = loadConfigOrExit();
const logger = createLogger(config);
const metrics = createMetrics({ collectProcessMetrics: true });

const postgres = createPostgresPool(
  { url: config.postgres.url, poolMax: 2, applicationName: 'portfolio-worker' },
  logger,
  metrics,
);
const redis = createRedisClient(
  { url: config.redis.url, connectionName: 'portfolio-worker' },
  logger,
  metrics,
);
// Only for BLMOVE, which blocks its connection while it waits.
const blockingRedis = createRedisClient(
  { url: config.redis.url, connectionName: 'portfolio-worker-blocking' },
  logger,
  metrics,
);

// Wiring: DAL → manager → worker loops (the worker's "controllers").
const telemetryFlusher = createTelemetryFlusher({
  flushManager: createTelemetryFlushManager({
    bufferDal: createEventBufferDal(redis),
    analyticsEventDal: createAnalyticsEventDal(postgres),
    metrics,
    batchSize: config.telemetry.batchSize,
  }),
  metrics,
  logger,
  batchSize: config.telemetry.batchSize,
  flushIntervalMs: config.telemetry.flushIntervalMs,
});

const notificationManager = createNotificationManager({
  contactMessageDal: createContactMessageDal(postgres),
  queueDal: createNotificationQueueDal(redis, blockingRedis),
  notifier: createNotifier(config.notifications.notifier, logger),
  metrics,
  maxAttempts: config.notifications.maxAttempts,
  backoffBaseMs: config.notifications.backoffBaseMs,
});
const notificationConsumer = createNotificationConsumer({
  notificationManager,
  metrics,
  logger,
  interruptWait: () => {
    blockingRedis.disconnect();
  },
});
const notificationPromoter = createPeriodicWorker({
  name: 'notification-promoter',
  intervalMs: PROMOTER_INTERVAL_MS,
  runImmediately: true,
  task: (log) => notificationManager.promoteDue(log),
  metrics,
  logger,
});
const notificationReconciler = createPeriodicWorker({
  name: 'notification-reconciler',
  intervalMs: RECONCILER_INTERVAL_MS,
  // Not at startup: after downtime, queued jobs would look "lost" until the consumer catches up.
  runImmediately: false,
  task: (log) => notificationManager.reconcile(log),
  metrics,
  logger,
});

// Stop every loop while connections are open (the flusher drains with the time left),
// then close them.
const gracefulShutdown = createGracefulShutdown({
  logger,
  timeoutMs: config.shutdown.timeoutMs,
  steps: [
    { name: 'notification-consumer', close: () => notificationConsumer.stop() },
    { name: 'notification-promoter', close: () => notificationPromoter.stop() },
    { name: 'notification-reconciler', close: () => notificationReconciler.stop() },
    {
      name: 'telemetry-flusher',
      close: (timeLeftMs) =>
        telemetryFlusher.stop(Math.max(0, timeLeftMs - CLOSE_CONNECTIONS_RESERVE_MS)),
    },
    // Already cut by the consumer's stop, maybe still closing: no QUIT.
    { name: 'redis-blocking', close: () => closeInterruptedRedis(blockingRedis) },
    { name: 'redis', close: () => closeRedis(redis) },
    { name: 'postgres', close: () => postgres.end() },
  ],
});
registerProcessHandlers(gracefulShutdown, logger);

try {
  // Like the API: no point starting the loops without both datastores.
  await Promise.all([connectRedis(redis), connectRedis(blockingRedis), pingPostgres(postgres)]);
  telemetryFlusher.start();
  notificationConsumer.start();
  notificationPromoter.start();
  notificationReconciler.start();
  logger.info(
    {
      batchSize: config.telemetry.batchSize,
      flushIntervalMs: config.telemetry.flushIntervalMs,
      notifier: config.notifications.notifier.driver,
      nodeEnv: config.nodeEnv,
    },
    'worker started',
  );
} catch (err) {
  logger.fatal({ err }, 'worker failed to start');
  await gracefulShutdown.shutdown('startup failure', 1);
}
