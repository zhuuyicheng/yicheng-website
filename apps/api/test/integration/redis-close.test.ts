import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeInterruptedRedis,
  closeRedis,
  connectRedis,
  createRedisClient,
  type Redis,
} from '../../src/infra/redis.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';

/** The worker's blocking connection: cut by the consumer on stop, closed later, maybe mid-close. */
describe('closing a Redis connection that was just cut', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  async function cutConnection(): Promise<Redis> {
    const redis = createRedisClient(
      { url: deps.config.redis.url, connectionName: 'portfolio-close-test' },
      deps.logger,
      deps.metrics,
    );
    await connectRedis(redis);
    redis.disconnect(); // what interruptWait does
    return redis;
  }

  it('still looks ready for a moment, so a QUIT fails (why the worker does not use it)', async () => {
    const redis = await cutConnection();

    expect(redis.status).toBe('ready');
    await expect(closeRedis(redis)).rejects.toThrow("Stream isn't writeable");
  });

  it('closes cleanly with closeInterruptedRedis, even when called twice', async () => {
    // Regression: closing it with closeRedis made the worker exit 1 when stopped before BLMOVE
    // was waiting (CI, 2026-11-22).
    const redis = await cutConnection();

    await expect(closeInterruptedRedis(redis)).resolves.toBeUndefined();
    await expect(closeInterruptedRedis(redis)).resolves.toBeUndefined();
    if (redis.status !== 'end') {
      await new Promise((resolve) => redis.once('end', resolve));
    }
    expect(redis.status).toBe('end');
  });
});
