import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../../src/infra/metrics.js';
import { createPeriodicWorker } from '../../../src/workers/periodic.worker.js';
import { counterValue } from '../../helpers/metrics.js';

const INTERVAL_MS = 1_000;
const OUTAGE = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

/**
 * Runs the real loop with a scripted task and a fake `sleep` that records every wait. While
 * the script has entries, sleeps return at once; then the next sleep blocks until stop().
 */
function setup(runImmediately: boolean) {
  const script: (Error | null)[] = []; // null = the task succeeds
  const sleeps: number[] = [];
  const counts = { runs: 0 };
  const metrics = createMetrics();
  let markWaiting: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => {
    markWaiting = resolve;
  });

  const worker = createPeriodicWorker({
    name: 'notification-promoter',
    intervalMs: INTERVAL_MS,
    runImmediately,
    task: () => {
      counts.runs += 1;
      const next = script.shift() ?? null;
      return next ? Promise.reject(next) : Promise.resolve();
    },
    metrics,
    logger: pino({ level: 'silent' }),
    sleep: (ms, signal) => {
      sleeps.push(ms);
      if (script.length > 0 || signal.aborted) {
        return Promise.resolve();
      }
      markWaiting();
      return new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true },
        );
      });
    },
  });
  return { worker, script, sleeps, counts, metrics, waiting };
}

describe('periodic worker loop', () => {
  it('runs right away when asked to, then once per interval', async () => {
    const { worker, script, sleeps, counts, waiting } = setup(true);
    script.push(null, null);

    worker.start();
    await waiting;

    expect(counts.runs).toBe(2);
    expect(sleeps).toEqual([INTERVAL_MS, INTERVAL_MS]);
    await worker.stop();
  });

  it('otherwise waits one interval before the first run', async () => {
    const { worker, sleeps, counts, waiting } = setup(false);

    worker.start();
    await waiting;

    expect(sleeps).toEqual([INTERVAL_MS]);
    expect(counts.runs).toBe(0);
    await worker.stop();
    expect(counts.runs).toBe(0); // stopped during the first wait: never ran
  });

  it('after failures, waits the longer of the interval and the backoff, and counts them', async () => {
    const { worker, script, sleeps, metrics, waiting } = setup(true);
    script.push(OUTAGE, OUTAGE, OUTAGE, OUTAGE, null);

    worker.start();
    await waiting;

    // backoff 500, 1000, 2000, 4000 vs interval 1000 → 1000, 1000, 2000, 4000; then normal
    expect(sleeps).toEqual([1_000, 1_000, 2_000, 4_000, INTERVAL_MS]);
    expect(
      await counterValue(metrics.workerLoopFailures, {
        loop: 'notification-promoter',
        kind: 'transient',
      }),
    ).toBe(4);
    await worker.stop();
  });
});
