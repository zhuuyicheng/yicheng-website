import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeInterruptedRedis,
  closeRedis,
  connectRedis,
  createRedisClient,
  type Redis,
} from '../../src/infra/redis.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';

/**
 * Closing the worker's blocking connection (src/worker.ts). The consumer cuts it on stop with
 * `disconnect()`, then a later shutdown step closes it, possibly before the socket has closed.
 */
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
    redis.disconnect(); // what the consumer's interruptWait does
    return redis;
  }

  it('still looks ready for a moment, so a QUIT fails (why the worker does not use it)', async () => {
    const redis = await cutConnection();

    expect(redis.status).toBe('ready');
    await expect(closeRedis(redis)).rejects.toThrow("Stream isn't writeable");
  });

  it('closes cleanly with closeInterruptedRedis, even when called twice', async () => {
    // Regression: the worker closed this connection with closeRedis and, when its stop signal
    // came before the consumer was waiting in BLMOVE, exited with code 1 (CI, 2026-11-22).
    const redis = await cutConnection();

    await expect(closeInterruptedRedis(redis)).resolves.toBeUndefined();
    await expect(closeInterruptedRedis(redis)).resolves.toBeUndefined();
    if (redis.status !== 'end') {
      await new Promise((resolve) => redis.once('end', resolve));
    }
    expect(redis.status).toBe('end');
  });
});
