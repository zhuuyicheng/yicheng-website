/**
 * Worker process entrypoint (composition root): background work that must never slow down an
 * HTTP request. Phase 3: the telemetry flusher (Redis buffer → Postgres). See DESIGN.md §2.1.
 *
 * Run exactly one worker (DESIGN.md §8.4): the in-flight list is a single Redis key.
 */
import { loadConfigOrExit } from './config/env.js';
import { createAnalyticsEventDal } from './dal/analytics-event.dal.js';
import { createEventBufferDal } from './dal/event-buffer.dal.js';
import { createLogger } from './infra/logger.js';
import { createMetrics } from './infra/metrics.js';
import { createPostgresPool, pingPostgres } from './infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient } from './infra/redis.js';
import { createGracefulShutdown, registerProcessHandlers } from './lifecycle/graceful-shutdown.js';
import { createTelemetryFlushManager } from './services/telemetry-flush.manager.js';
import { createTelemetryFlusher } from './workers/telemetry-flusher.worker.js';

/** Part of the shutdown deadline kept for closing connections after draining. */
const CLOSE_CONNECTIONS_RESERVE_MS = 1_000;

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

// Wiring: DAL → manager → worker loop (the worker's "controller").
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

// Order matters: drain the buffer while the connections are still open, then close them.
const drainForMs = Math.max(0, config.shutdown.timeoutMs - CLOSE_CONNECTIONS_RESERVE_MS);
const gracefulShutdown = createGracefulShutdown({
  logger,
  timeoutMs: config.shutdown.timeoutMs,
  steps: [
    { name: 'telemetry-flusher', close: () => telemetryFlusher.stop(drainForMs) },
    { name: 'redis', close: () => closeRedis(redis) },
    { name: 'postgres', close: () => postgres.end() },
  ],
});
registerProcessHandlers(gracefulShutdown, logger);

try {
  // Fail fast, like the API: no point starting the loop without both datastores.
  await Promise.all([connectRedis(redis), pingPostgres(postgres)]);
  telemetryFlusher.start();
  logger.info(
    {
      batchSize: config.telemetry.batchSize,
      flushIntervalMs: config.telemetry.flushIntervalMs,
      nodeEnv: config.nodeEnv,
    },
    'worker started',
  );
} catch (err) {
  logger.fatal({ err }, 'worker failed to start');
  await gracefulShutdown.shutdown('startup failure', 1);
}
