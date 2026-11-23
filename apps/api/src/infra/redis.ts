import { Redis } from 'ioredis';
import type { Logger } from './logger.js';
import type { Metrics } from './metrics.js';

export type { Redis } from 'ioredis';

export interface RedisOptions {
  url: string;
  /** Shown in CLIENT LIST, to tell connections apart. */
  connectionName: string;
}

const MAX_RECONNECT_DELAY_MS = 2_000;

export function createRedisClient(options: RedisOptions, logger: Logger, metrics: Metrics): Redis {
  const redis = new Redis(options.url, {
    connectionName: options.connectionName,
    // Connected explicitly at startup (connectRedis), so an unreachable Redis fails fast.
    lazyConnect: true,
    // While disconnected, fail commands at once instead of queueing them in memory.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => {
      const delayMs = Math.min(attempt * 200, MAX_RECONNECT_DELAY_MS);
      logger.warn({ attempt, delayMs, client: options.connectionName }, 'redis reconnecting');
      metrics.redisReconnects.inc({ client: options.connectionName });
      return delayMs;
    },
  });

  redis.on('error', (err) => {
    logger.error({ err }, 'redis connection error');
  });

  return redis;
}

export async function connectRedis(redis: Redis): Promise<void> {
  await redis.connect();
}

export async function pingRedis(redis: Redis): Promise<void> {
  await redis.ping();
}

/** QUIT lets pending replies arrive; a client that isn't connected is just torn down. */
export async function closeRedis(redis: Redis): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit();
    return;
  }
  redis.disconnect();
}

/**
 * For the worker's blocking connection, which the consumer cuts on stop. ioredis still says
 * `ready` until the socket closes, so QUIT would fail ("Stream isn't writeable"); this only
 * disconnects (safe to repeat).
 */
export function closeInterruptedRedis(redis: Redis): Promise<void> {
  redis.disconnect();
  return Promise.resolve();
}
