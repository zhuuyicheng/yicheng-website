/** API entrypoint (composition root): config, infra clients, HTTP server, shutdown. */
import { buildApp } from './app.js';
import { loadConfigOrExit } from './config/env.js';
import type { IpDatabases } from './dal/ip-location.dal.js';
import { createGracefulShutdown, registerProcessHandlers } from './lifecycle/graceful-shutdown.js';
import { openIpDatabases } from './infra/ip-databases.js';
import { createLogger } from './infra/logger.js';
import { createMetrics } from './infra/metrics.js';
import { createPostgresPool, pingPostgres } from './infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient } from './infra/redis.js';

const config = loadConfigOrExit();
const logger = createLogger(config);
const metrics = createMetrics({ collectProcessMetrics: true });

// Before any connection opens, so a missing file can just exit (like bad config).
let ipDatabases: IpDatabases;
try {
  ipDatabases = await openIpDatabases(config.ipLookup, logger);
} catch (err) {
  logger.fatal({ err }, 'api failed to start');
  process.exit(1);
}

const postgres = createPostgresPool(
  { url: config.postgres.url, poolMax: config.postgres.poolMax, applicationName: 'portfolio-api' },
  logger,
  metrics,
);
const redis = createRedisClient(
  { url: config.redis.url, connectionName: 'portfolio-api' },
  logger,
  metrics,
);
const app = buildApp({ config, logger, metrics, postgres, redis, ipDatabases });

// Stop taking requests first, then close what they were using.
const gracefulShutdown = createGracefulShutdown({
  logger,
  timeoutMs: config.shutdown.timeoutMs,
  steps: [
    { name: 'http-server', close: () => app.close() },
    { name: 'redis', close: () => closeRedis(redis) },
    { name: 'postgres', close: () => postgres.end() },
  ],
});
registerProcessHandlers(gracefulShutdown, logger);

try {
  // Don't serve traffic until both datastores answer.
  await Promise.all([connectRedis(redis), pingPostgres(postgres)]);
  const address = await app.listen({ host: config.server.host, port: config.server.port });
  logger.info({ address, nodeEnv: config.nodeEnv }, 'api started');
} catch (err) {
  logger.fatal({ err }, 'api failed to start');
  await gracefulShutdown.shutdown('startup failure', 1);
}
