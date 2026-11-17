import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMetrics, type Metrics } from '../../../src/infra/metrics.js';
import type { CacheStore } from '../../../src/repositories/content-cache.store.js';
import {
  createCacheAside,
  ttlWithJitter,
  type CacheAsideRead,
} from '../../../src/services/cache-aside.js';
import { counterValue } from '../../helpers/metrics.js';

const log = pino({ level: 'silent' });
const TTL_SECONDS = 300;

const itemSchema = z.object({ name: z.string() });
type Item = z.infer<typeof itemSchema>;

/** In-memory stand-in for Redis, with switches to simulate failures. */
function createFakeStore() {
  const entries = new Map<string, string>();
  const ttls = new Map<string, number>();
  const failures = { reads: false, writes: false };

  const store: CacheStore = {
    get: (key) =>
      failures.reads
        ? Promise.reject(new Error('redis unavailable'))
        : Promise.resolve(entries.get(key) ?? null),
    set: (key, value, ttlSeconds) => {
      if (failures.writes) {
        return Promise.reject(new Error('redis unavailable'));
      }
      entries.set(key, value);
      ttls.set(key, ttlSeconds);
      return Promise.resolve();
    },
  };
  return { store, entries, ttls, failures };
}

function setup(random: () => number = () => 0.5) {
  const fake = createFakeStore();
  const metrics: Metrics = createMetrics();
  const cache = createCacheAside({ store: fake.store, metrics, ttlSeconds: TTL_SECONDS, random });
  return { ...fake, metrics, cache };
}

function itemRequest(load: () => Promise<Item | null>): CacheAsideRead<Item> {
  return { cacheName: 'item', key: 'cache:v1:item', schema: itemSchema, load };
}

describe('cache-aside read', () => {
  it('loads from the source on a miss and stores the value with a TTL', async () => {
    const { cache, entries, ttls, metrics } = setup();
    const load = vi.fn(() => Promise.resolve({ name: 'fresh' }));

    const result = await cache.read(itemRequest(load), log);

    expect(result).toEqual({ value: { name: 'fresh' }, cache: 'miss' });
    expect(load).toHaveBeenCalledOnce();
    expect(entries.get('cache:v1:item')).toBe('{"name":"fresh"}');
    expect(ttls.get('cache:v1:item')).toBe(TTL_SECONDS);
    expect(await counterValue(metrics.cacheRequests, { cache: 'item', result: 'miss' })).toBe(1);
  });

  it('serves the second read from the cache without touching the source', async () => {
    const { cache, metrics } = setup();
    const load = vi.fn(() => Promise.resolve({ name: 'fresh' }));

    await cache.read(itemRequest(load), log);
    const second = await cache.read(itemRequest(load), log);

    expect(second).toEqual({ value: { name: 'fresh' }, cache: 'hit' });
    expect(load).toHaveBeenCalledOnce();
    expect(await counterValue(metrics.cacheRequests, { result: 'hit' })).toBe(1);
  });

  it('does not cache "not found", so newly published content shows up immediately', async () => {
    const { cache, entries } = setup();

    const result = await cache.read(
      itemRequest(() => Promise.resolve(null)),
      log,
    );

    expect(result).toEqual({ value: null, cache: 'miss' });
    expect(entries.size).toBe(0);
  });

  it('falls back to the source when Redis cannot be read, and counts the error', async () => {
    const { cache, failures, metrics } = setup();
    failures.reads = true;

    const result = await cache.read(
      itemRequest(() => Promise.resolve({ name: 'fresh' })),
      log,
    );

    expect(result).toEqual({ value: { name: 'fresh' }, cache: 'miss' });
    expect(await counterValue(metrics.cacheErrors, { operation: 'read' })).toBe(1);
  });

  it('still returns the value when Redis cannot be written, and counts the error', async () => {
    const { cache, failures, metrics } = setup();
    failures.writes = true;

    const result = await cache.read(
      itemRequest(() => Promise.resolve({ name: 'fresh' })),
      log,
    );

    expect(result.value).toEqual({ name: 'fresh' });
    expect(await counterValue(metrics.cacheErrors, { operation: 'write' })).toBe(1);
  });

  it.each([
    ['invalid JSON', '{"name": '],
    ['an unexpected shape', '{"title":"old shape"}'],
  ])('treats an entry with %s as a miss and overwrites it', async (_case, corrupt) => {
    const { cache, entries, metrics } = setup();
    entries.set('cache:v1:item', corrupt);

    const result = await cache.read(
      itemRequest(() => Promise.resolve({ name: 'fresh' })),
      log,
    );

    expect(result).toEqual({ value: { name: 'fresh' }, cache: 'miss' });
    expect(entries.get('cache:v1:item')).toBe('{"name":"fresh"}');
    expect(await counterValue(metrics.cacheErrors, { operation: 'decode' })).toBe(1);
  });

  it('shares one source load between concurrent misses for the same key (single-flight)', async () => {
    const { cache } = setup();
    let finishLoad: (item: Item) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<Item>((resolve) => {
          finishLoad = resolve;
        }),
    );

    const reads = Array.from({ length: 5 }, () => cache.read(itemRequest(load), log));
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalled();
    });
    finishLoad({ name: 'fresh' });
    const results = await Promise.all(reads);

    expect(load).toHaveBeenCalledOnce();
    expect(results.every((result) => result.value?.name === 'fresh')).toBe(true);
  });

  it('lets the next request retry after a failed load', async () => {
    const { cache } = setup();
    const load = vi
      .fn<() => Promise<Item | null>>()
      .mockRejectedValueOnce(new Error('postgres down'))
      .mockResolvedValueOnce({ name: 'fresh' });

    await expect(cache.read(itemRequest(load), log)).rejects.toThrow('postgres down');
    const retry = await cache.read(itemRequest(load), log);

    expect(retry.value).toEqual({ name: 'fresh' });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('ttlWithJitter', () => {
  it('stays within ±10 % of the base TTL', () => {
    expect(ttlWithJitter(300, () => 0)).toBe(270);
    expect(ttlWithJitter(300, () => 0.5)).toBe(300);
    expect(ttlWithJitter(300, () => 0.999_999)).toBe(330);
  });

  it('never returns less than one second', () => {
    expect(ttlWithJitter(1, () => 0)).toBe(1);
  });
});
