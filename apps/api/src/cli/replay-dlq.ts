/**
 * `npm run dlq:replay -- <telemetry|notifications>`: retries dead letters once their cause is
 * fixed (DESIGN.md §8.2, §8.3). Unreadable entries stay, and the command exits 1.
 */
import { loadConfigOrExit, type AppConfig } from '../config/env.js';
import { createContactMessageDal } from '../dal/contact-message.dal.js';
import { createEventBufferDal } from '../dal/event-buffer.dal.js';
import { createNotificationQueueDal } from '../dal/notification-queue.dal.js';
import { createLogger, type Logger } from '../infra/logger.js';
import { createMetrics } from '../infra/metrics.js';
import { createPostgresPool } from '../infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient, type Redis } from '../infra/redis.js';
import { createNotificationDlqManager } from '../services/notification-dlq.manager.js';
import {
  createTelemetryDlqManager,
  type ReplayOutcome,
} from '../services/telemetry-dlq.manager.js';

const QUEUES = ['telemetry', 'notifications'] as const;
type Queue = (typeof QUEUES)[number];
const USAGE = `Usage: npm run dlq:replay -- <${QUEUES.join(' | ')}>\n`;

function isQueue(name: string | undefined): name is Queue {
  return QUEUES.some((queue) => queue === name);
}

const queue = process.argv[2];
if (!isQueue(queue)) {
  process.stderr.write(USAGE);
  process.exit(1);
}

const config = loadConfigOrExit();
const logger = createLogger(config);
const metrics = createMetrics();
const redis = createRedisClient(
  { url: config.redis.url, connectionName: 'portfolio-dlq-replay' },
  logger,
  metrics,
);

/** Also needs Postgres, to reopen the FAILED messages. */
async function replayNotifications(
  appConfig: AppConfig,
  client: Redis,
  log: Logger,
): Promise<ReplayOutcome> {
  const postgres = createPostgresPool(
    { url: appConfig.postgres.url, poolMax: 1, applicationName: 'portfolio-dlq-replay' },
    log,
    metrics,
  );
  try {
    const dlqManager = createNotificationDlqManager({
      queueDal: createNotificationQueueDal(client),
      contactMessageDal: createContactMessageDal(postgres),
    });
    return await dlqManager.replay(log);
  } finally {
    await postgres.end();
  }
}

try {
  await connectRedis(redis);
  const outcome =
    queue === 'telemetry'
      ? await createTelemetryDlqManager({ bufferDal: createEventBufferDal(redis) }).replay(logger)
      : await replayNotifications(config, redis, logger);
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
