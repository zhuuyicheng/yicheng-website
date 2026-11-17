import { loadConfig, type AppConfig } from '../../src/config/env.js';
import { createLogger, type Logger } from '../../src/infra/logger.js';
import { createPostgresPool, type PostgresPool } from '../../src/infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient, type Redis } from '../../src/infra/redis.js';

export interface TestDependencies {
  config: AppConfig;
  logger: Logger;
  postgres: PostgresPool;
  redis: Redis;
  close: () => Promise<void>;
}

/** Real, connected Postgres + Redis clients configured from the integration test env. */
export async function createTestDependencies(): Promise<TestDependencies> {
  const config = loadConfig();
  const logger = createLogger(config);
  const postgres = createPostgresPool(
    { url: config.postgres.url, poolMax: 2, applicationName: 'portfolio-api-test' },
    logger,
  );
  const redis = createRedisClient(
    { url: config.redis.url, connectionName: 'portfolio-api-test' },
    logger,
  );
  await connectRedis(redis);

  return {
    config,
    logger,
    postgres,
    redis,
    close: async () => {
      await closeRedis(redis);
      await postgres.end();
    },
  };
}

/** A URL on which nothing listens: connections are refused immediately. */
export const UNREACHABLE_POSTGRES_URL = 'postgres://portfolio:portfolio@127.0.0.1:1/unreachable';
export const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1/0';
