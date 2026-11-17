import { Pool } from 'pg';
import type { Logger } from './logger.js';
import type { Metrics } from './metrics.js';

export type { Pool as PostgresPool } from 'pg';

export interface PostgresOptions {
  url: string;
  poolMax: number;
  /** Shows up in pg_stat_activity, which makes it easy to tell connections apart. */
  applicationName: string;
}

export function createPostgresPool(
  options: PostgresOptions,
  logger: Logger,
  metrics: Metrics,
): Pool {
  const pool = new Pool({
    connectionString: options.url,
    max: options.poolMax,
    application_name: options.applicationName,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });

  // An idle client can lose its connection at any time (e.g. Postgres restarts).
  // pg emits that as an 'error' event on the pool, which crashes the process if unhandled.
  pool.on('error', (err) => {
    logger.error({ err }, 'postgres idle client error');
    metrics.postgresPoolErrors.inc();
  });

  return pool;
}

export async function pingPostgres(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}
