/**
 * Environment for integration tests. They run against the docker-compose services but never
 * against development data: a dedicated database and Redis logical DB 1.
 * Override with TEST_DATABASE_URL / TEST_REDIS_URL if your local ports or credentials differ.
 */
export const integrationTestEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgres://portfolio:portfolio@localhost:5432/portfolio_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  IP_HASH_SECRET: 'integration-test-ip-hash-secret-0123456789',
  ADMIN_TOKEN: 'integration-test-admin-token-0123456789abcdef',
} as const;
