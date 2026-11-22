import { Redis } from 'ioredis';
import type { Logger } from './logger.js';
import type { Metrics } from './metrics.js';

export type { Redis } from 'ioredis';

export interface RedisOptions {
  url: string;
  /** Shows up in CLIENT LIST, which makes it easy to tell connections apart. */
  connectionName: string;
}

const MAX_RECONNECT_DELAY_MS = 2_000;

export function createRedisClient(options: RedisOptions, logger: Logger, metrics: Metrics): Redis {
  const redis = new Redis(options.url, {
    connectionName: options.connectionName,
    // Connect explicitly at startup (see connectRedis) so an unreachable Redis fails fast.
    lazyConnect: true,
    // While disconnected, fail commands immediately instead of queueing them in memory.
    // Callers then see an explicit error they can handle (503, cache fallback, ...).
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

/** QUIT lets pending replies arrive first; a client that is not connected is just torn down. */
export async function closeRedis(redis: Redis): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit();
    return;
  }
  redis.disconnect();
}

/**
 * Closes a connection that may already be closing: the worker's blocking connection, which
 * the notification consumer cuts on stop to end a pending BLMOVE. Right after `disconnect()`
 * ioredis still reports `ready` until the socket has closed, and `closeRedis`'s QUIT then fails
 * ("Stream isn't writeable"), which made the worker exit with code 1 now and then in CI. Such a
 * connection has no replies worth waiting for, so this only disconnects (safe to repeat).
 */
export function closeInterruptedRedis(redis: Redis): Promise<void> {
  redis.disconnect();
  return Promise.resolve();
}
