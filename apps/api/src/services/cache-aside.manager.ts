import type { z } from 'zod';
import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import type { CacheDal } from '../dal/content-cache.dal.js';

/**
 * Cache-aside ("lazy loading"), see DESIGN.md §8.1:
 *
 *   1. Look in Redis. Hit → validate and return it.
 *   2. Miss → load from the source of truth (Postgres), store it in Redis with a TTL, return it.
 *
 * Redis is an optimisation, never a dependency: if it fails, or holds something unreadable,
 * we log + count it and serve from Postgres instead.
 */

/** Whether a value came from the cache. Surfaced to clients as the `X-Cache` header. */
export type CacheResult = 'hit' | 'miss';

export interface Cached<T> {
  value: T;
  cache: CacheResult;
}

export interface CacheAsideRead<T> {
  /** Low-cardinality metric label, e.g. `project` (not `project:my-slug`). */
  cacheName: string;
  key: string;
  /** Validates what comes back out of Redis. */
  schema: z.ZodType<T>;
  /** Reads the source of truth; `null` means "does not exist" and is not cached. */
  load: () => Promise<T | null>;
}

export interface CacheAsideManager {
  read: <T>(request: CacheAsideRead<T>, log: Logger) => Promise<Cached<T | null>>;
}

export interface CacheAsideOptions {
  cacheDal: CacheDal;
  metrics: Metrics;
  ttlSeconds: number;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
}

/** ±10 %: entries written together expire at different times, so they are not reloaded at once. */
export const TTL_JITTER_RATIO = 0.1;

export function ttlWithJitter(baseSeconds: number, random: () => number = Math.random): number {
  const factor = 1 + (random() * 2 - 1) * TTL_JITTER_RATIO;
  return Math.max(1, Math.round(baseSeconds * factor));
}

type Lookup<T> = { found: true; value: T } | { found: false };

export function createCacheAsideManager(options: CacheAsideOptions): CacheAsideManager {
  const { cacheDal, metrics, ttlSeconds, random = Math.random } = options;

  /**
   * Single-flight: while one request is loading a key from Postgres, concurrent misses for the
   * same key await that same promise instead of each running the query (a "cache stampede").
   */
  const loadsInFlight = new Map<string, Promise<unknown>>();

  function recordError(
    operation: 'read' | 'write' | 'decode',
    err: unknown,
    key: string,
    log: Logger,
  ) {
    log.warn({ err, operation, key }, 'cache operation failed, serving from postgres');
    metrics.cacheErrors.inc({ operation });
  }

  async function lookup<T>(request: CacheAsideRead<T>, log: Logger): Promise<Lookup<T>> {
    let raw: string | null;
    try {
      raw = await cacheDal.get(request.key);
    } catch (err) {
      recordError('read', err, request.key, log);
      return { found: false };
    }
    if (raw === null) {
      return { found: false };
    }

    // A corrupt or outdated entry is treated as a miss; the fresh value then overwrites it.
    try {
      return { found: true, value: request.schema.parse(JSON.parse(raw)) };
    } catch (err) {
      recordError('decode', err, request.key, log);
      return { found: false };
    }
  }

  async function loadAndStore<T>(request: CacheAsideRead<T>, log: Logger): Promise<T | null> {
    const value = await request.load();
    if (value === null) {
      return null;
    }

    try {
      await cacheDal.set(request.key, JSON.stringify(value), ttlWithJitter(ttlSeconds, random));
    } catch (err) {
      recordError('write', err, request.key, log);
    }
    return value;
  }

  function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = loadsInFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const pending = run().finally(() => loadsInFlight.delete(key));
    loadsInFlight.set(key, pending);
    return pending;
  }

  return {
    async read(request, log) {
      // redis
      const cached = await lookup(request, log);
      if (cached.found) {
        metrics.cacheRequests.inc({ cache: request.cacheName, result: 'hit' });
        return { value: cached.value, cache: 'hit' };
      }
      // miss → Postgres, then save to Redis
      metrics.cacheRequests.inc({ cache: request.cacheName, result: 'miss' });
      const value = await singleFlight(request.key, () => loadAndStore(request, log));
      return { value, cache: 'miss' };
    },
  };
}
