import { describe, expect, it } from 'vitest';
import { sleep } from '../../../src/infra/sleep.js';

describe('sleep', () => {
  it('waits for the given time', async () => {
    const started = performance.now();

    await sleep(25, new AbortController().signal);

    expect(performance.now() - started).toBeGreaterThanOrEqual(20);
  });

  it('wakes up early, without throwing, when the signal aborts', async () => {
    const controller = new AbortController();
    const started = performance.now();

    const sleeping = sleep(60_000, controller.signal);
    controller.abort();

    await expect(sleeping).resolves.toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('returns at once if the signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(60_000, controller.signal)).resolves.toBeUndefined();
  });
});
