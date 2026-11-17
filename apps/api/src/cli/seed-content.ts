/**
 * `npm run content:seed` — publishes content/portfolio.json:
 *   1. validate the file (every problem is listed, nothing is written if any exist),
 *   2. make Postgres match it in one transaction,
 *   3. clear the content cache and warm it again.
 * See DESIGN.md §8.1.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfigOrExit } from '../config/env.js';
import { createLogger } from '../infra/logger.js';
import { createMetrics } from '../infra/metrics.js';
import { createPostgresPool } from '../infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient } from '../infra/redis.js';
import { portfolioContentSchema, type PortfolioContent } from '../models/content.model.js';
import { createContentCacheStore } from '../repositories/content-cache.store.js';
import { createContentRepository } from '../repositories/content.repository.js';
import { createCacheAside } from '../services/cache-aside.js';
import { createContentService } from '../services/content.service.js';

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

  const cacheStore = createContentCacheStore(redis);
  const contentService = createContentService({
    repository: createContentRepository(postgres),
    cacheStore,
    cache: createCacheAside({ store: cacheStore, metrics, ttlSeconds: config.cache.ttlSeconds }),
  });

  const summary = await contentService.publish(content, logger);
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
