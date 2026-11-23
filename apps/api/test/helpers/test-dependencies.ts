import { loadConfig, type AppConfig } from '../../src/config/env.js';
import { NO_IP_DATABASES, type IpDatabases } from '../../src/dal/ip-location.dal.js';
import { createLogger, type Logger } from '../../src/infra/logger.js';
import { createMetrics, type Metrics } from '../../src/infra/metrics.js';
import { createPostgresPool, type PostgresPool } from '../../src/infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient, type Redis } from '../../src/infra/redis.js';

export interface TestDependencies {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  postgres: PostgresPool;
  redis: Redis;
  ipDatabases: IpDatabases;
  close: () => Promise<void>;
}

/** Connected Postgres and Redis clients from the test env. IP lookup is off (no GeoIP files). */
export async function createTestDependencies(): Promise<TestDependencies> {
  const config = loadConfig();
  const logger = createLogger(config);
  // Fresh per test file, so counters start at zero.
  const metrics = createMetrics();
  const postgres = createPostgresPool(
    { url: config.postgres.url, poolMax: 2, applicationName: 'portfolio-api-test' },
    logger,
    metrics,
  );
  const redis = createRedisClient(
    { url: config.redis.url, connectionName: 'portfolio-api-test' },
    logger,
    metrics,
  );
  await connectRedis(redis);

  return {
    config,
    logger,
    metrics,
    postgres,
    redis,
    ipDatabases: NO_IP_DATABASES,
    close: async () => {
      await closeRedis(redis);
      await postgres.end();
    },
  };
}

/** Nothing listens here: connections are refused at once. */
export const UNREACHABLE_POSTGRES_URL = 'postgres://portfolio:portfolio@127.0.0.1:1/unreachable';
export const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1/0';
