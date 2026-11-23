/**
 * `npm run content:seed`: validates content/portfolio.json (nothing is written if it's
 * invalid), makes Postgres match it in one transaction, then clears and warms the cache.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfigOrExit } from '../config/env.js';
import { createLogger } from '../infra/logger.js';
import { createMetrics } from '../infra/metrics.js';
import { createPostgresPool } from '../infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient } from '../infra/redis.js';
import { portfolioContentSchema, type PortfolioContent } from '../schema/content.schema.js';
import { createContentCacheDal } from '../dal/content-cache.dal.js';
import { createContentDal } from '../dal/content.dal.js';
import { createCacheAsideManager } from '../services/cache-aside.manager.js';
import { createContentManager } from '../services/content.manager.js';

const CONTENT_FILE = path.resolve(import.meta.dirname, '../../content/portfolio.json');

class ContentFileError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`${CONTENT_FILE} is invalid`);
    this.name = 'ContentFileError';
    this.problems = problems;
  }
}

async function readContentFile(file: string): Promise<PortfolioContent> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ContentFileError([reason]);
  }

  const result = portfolioContentSchema.safeParse(json);
  if (!result.success) {
    throw new ContentFileError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

const config = loadConfigOrExit();
const logger = createLogger(config);
const metrics = createMetrics();
const postgres = createPostgresPool(
  { url: config.postgres.url, poolMax: 2, applicationName: 'portfolio-seed' },
  logger,
  metrics,
);
const redis = createRedisClient(
  { url: config.redis.url, connectionName: 'portfolio-seed' },
  logger,
  metrics,
);

try {
  const content = await readContentFile(CONTENT_FILE);
  await connectRedis(redis);

  const cacheDal = createContentCacheDal(redis);
  const contentManager = createContentManager({
    dal: createContentDal(postgres),
    cacheDal,
    cache: createCacheAsideManager({ cacheDal, metrics, ttlSeconds: config.cache.ttlSeconds }),
  });

  const summary = await contentManager.publish(content, logger);
  logger.info(summary, 'content published');
} catch (err) {
  if (err instanceof ContentFileError) {
    logger.fatal({ problems: err.problems }, err.message);
  } else {
    logger.fatal(
      { err },
      'content seed failed (if Postgres was updated, the cache may be stale until its TTL)',
    );
  }
  process.exitCode = 1;
} finally {
  await closeRedis(redis);
  await postgres.end();
}
