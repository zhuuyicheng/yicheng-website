/**
 * `npm run db:migrate` — applies pending SQL migrations, then exits.
 * Run as a deploy step; the API never migrates on boot.
 */
import { loadConfigOrExit } from '../config/env.js';
import { createLogger } from '../infra/logger.js';
import { createMetrics } from '../infra/metrics.js';
import { createPostgresPool } from '../infra/postgres.js';
import { DEFAULT_MIGRATIONS_DIRECTORY, runMigrations } from '../db/migrator.js';

const config = loadConfigOrExit();
const logger = createLogger(config);
const pool = createPostgresPool(
  { url: config.postgres.url, poolMax: 1, applicationName: 'portfolio-migrator' },
  logger,
  createMetrics(),
);

try {
  const { applied } = await runMigrations({
    pool,
    directory: DEFAULT_MIGRATIONS_DIRECTORY,
    logger,
  });
  logger.info({ appliedCount: applied.length }, 'migrations finished');
} catch (err) {
  logger.fatal({ err }, 'migrations failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
