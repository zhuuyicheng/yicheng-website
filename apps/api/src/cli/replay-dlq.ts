/**
 * `npm run dlq:replay -- telemetry` — moves dead-lettered telemetry events back into the
 * buffer, so the worker retries them. Run it after fixing what made them fail. DESIGN.md §8.2.
 *
 * Phase 4 adds a second queue name (`notifications`).
 */
import { loadConfigOrExit } from '../config/env.js';
import { createEventBufferDal } from '../dal/event-buffer.dal.js';
import { createLogger } from '../infra/logger.js';
import { createMetrics } from '../infra/metrics.js';
import { closeRedis, connectRedis, createRedisClient } from '../infra/redis.js';
import { createTelemetryDlqManager } from '../services/telemetry-dlq.manager.js';

const USAGE = 'Usage: npm run dlq:replay -- telemetry\n';

const queue = process.argv[2];
if (queue !== 'telemetry') {
  process.stderr.write(USAGE);
  process.exit(1);
}

const config = loadConfigOrExit();
const logger = createLogger(config);
const redis = createRedisClient(
  { url: config.redis.url, connectionName: 'portfolio-dlq-replay' },
  logger,
  createMetrics(),
);

try {
  await connectRedis(redis);
  const dlqManager = createTelemetryDlqManager({ bufferDal: createEventBufferDal(redis) });
  const outcome = await dlqManager.replay(logger);
  logger.info({ queue, ...outcome }, 'dead letters replayed');
  if (outcome.unreadable > 0) {
    process.exitCode = 1; // not everything could be replayed
  }
} catch (err) {
  logger.fatal({ err, queue }, 'dead-letter replay failed');
  process.exitCode = 1;
} finally {
  await closeRedis(redis);
}
