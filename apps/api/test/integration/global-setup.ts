/**
 * Runs once before the integration suite:
 *   1. checks that docker-compose Postgres and Redis are reachable (with an actionable error),
 *   2. creates the test database if it does not exist,
 *   3. applies all migrations to it.
 */
import { Redis } from 'ioredis';
import pg from 'pg';
import { pino } from 'pino';
import { DEFAULT_MIGRATIONS_DIRECTORY, runMigrations } from '../../src/db/migrator.js';
import { integrationTestEnv } from './test-env.js';

const START_INFRA_HINT = 'Is Docker running? Start the datastores with `npm run infra:up`.';

export default async function setup(): Promise<void> {
  await assertRedisReachable(integrationTestEnv.REDIS_URL);
  await ensureDatabaseExists(integrationTestEnv.DATABASE_URL);

  const pool = new pg.Pool({ connectionString: integrationTestEnv.DATABASE_URL, max: 1 });
  try {
    await runMigrations({
      pool,
      directory: DEFAULT_MIGRATIONS_DIRECTORY,
      logger: pino({ level: 'silent' }),
    });
  } finally {
    await pool.end();
  }
}

async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsafe test database name "${databaseName}"`);
  }

  // Connect to the always-present maintenance database to create the test database.
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(`Cannot connect to Postgres at ${url.host}. ${START_INFRA_HINT}`, {
      cause: error,
    });
  }

  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      // Identifiers cannot be bound as parameters; the name was validated above.
      await client.query(`CREATE DATABASE ${databaseName}`);
    }
  } finally {
    await client.end();
  }
}

async function assertRedisReachable(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0 });
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Cannot connect to Redis at ${redisUrl}. ${START_INFRA_HINT}`, {
      cause: error,
    });
  } finally {
    redis.disconnect();
  }
}
