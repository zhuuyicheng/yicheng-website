import type { Redis } from '../infra/redis.js';

/**
 * Redis keys for cached content. See DESIGN.md §6.2. `vN` is the shape version: bump it when
 * a cached response shape changes, so old entries are never read and simply expire. During a
 * deploy, old and new code then use different keys instead of overwriting each other's entries.
 */
export const CONTENT_CACHE_KEYS = {
  profile: 'cache:v3:profile', // v2: added `education`, v3: `contentUpdatedAt`
  projects: 'cache:v1:projects',
  project: (slug: string) => `cache:v3:project:${slug}`, // v2: added `sections`, v3: `updatedAt`
} as const;

const PROJECT_KEY_PATTERN = CONTENT_CACHE_KEYS.project('*');
const SCAN_BATCH_SIZE = 100;

/** Minimal key/value cache used by the cache-aside manager. Values are JSON strings. */
export interface CacheDal {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>;
}

export interface ContentCacheDal extends CacheDal {
  /** Deletes every content cache key (including projects that no longer exist). */
  deleteAllContent: () => Promise<number>;
}

export function createContentCacheDal(redis: Redis): ContentCacheDal {
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
