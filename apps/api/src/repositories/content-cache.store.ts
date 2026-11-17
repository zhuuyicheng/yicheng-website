import type { Redis } from '../infra/redis.js';

/**
 * Redis keys for cached content. See DESIGN.md §6.2. `v1` is the shape version: bump it when
 * a cached response shape changes, so old entries are never read and simply expire.
 */
export const CONTENT_CACHE_KEYS = {
  profile: 'cache:v1:profile',
  projects: 'cache:v1:projects',
  project: (slug: string) => `cache:v1:project:${slug}`,
} as const;

const PROJECT_KEY_PATTERN = CONTENT_CACHE_KEYS.project('*');
const SCAN_BATCH_SIZE = 100;

/** Minimal key/value cache used by the cache-aside service. Values are JSON strings. */
export interface CacheStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>;
}

export interface ContentCacheStore extends CacheStore {
  /** Deletes every content cache key (including projects that no longer exist). */
  deleteAllContent: () => Promise<number>;
}

export function createContentCacheStore(redis: Redis): ContentCacheStore {
  return {
    async get(key) {
      return redis.get(key);
    },

    async set(key, value, ttlSeconds) {
      await redis.set(key, value, 'EX', ttlSeconds);
    },

    async deleteAllContent() {
      // SCAN walks the keyspace in small steps, unlike KEYS, which blocks Redis until done.
      const keys: string[] = [CONTENT_CACHE_KEYS.profile, CONTENT_CACHE_KEYS.projects];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await redis.scan(
          cursor,
          'MATCH',
          PROJECT_KEY_PATTERN,
          'COUNT',
          SCAN_BATCH_SIZE,
        );
        keys.push(...batch);
        cursor = nextCursor;
      } while (cursor !== '0');

      return redis.del(...keys);
    },
  };
}
