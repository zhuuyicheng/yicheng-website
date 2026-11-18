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

/**
 * Real, connected Postgres + Redis clients configured from the integration test env. IP lookup
 * is off (no GeoIP files); tests that need it open the fixtures in test/fixtures/geoip.
 */
export async function createTestDependencies(): Promise<TestDependencies> {
  const config = loadConfig();
  const logger = createLogger(config);
  // A fresh registry per test file, so counter assertions start from zero.
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

/** A URL on which nothing listens: connections are refused immediately. */
export const UNREACHABLE_POSTGRES_URL = 'postgres://portfolio:portfolio@127.0.0.1:1/unreachable';
export const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1/0';
