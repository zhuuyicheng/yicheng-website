import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../../src/infra/metrics.js';
import type { FlushOutcome } from '../../../src/services/telemetry-flush.manager.js';
import { createTelemetryFlusher } from '../../../src/workers/telemetry-flusher.worker.js';
import { counterValue } from '../../helpers/metrics.js';

const BATCH_SIZE = 50;
const INTERVAL_MS = 5_000;
const EMPTY: FlushOutcome = { claimed: 0, inserted: 0, deadLettered: 0 };
const batchOf = (claimed: number): FlushOutcome => ({
  claimed,
  inserted: claimed,
  deadLettered: 0,
});
const OUTAGE = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

/**
 * Runs the real loop against a scripted flush manager and a fake `sleep` that records every
 * wait. While outcomes remain in the script, sleeps return at once; when the script runs out,
 * the loop's next sleep blocks until stop() wakes it, and `waiting` resolves.
 */
function setup(options: { msPerFlush?: number } = {}) {
  const script: (FlushOutcome | Error)[] = [];
  const sleeps: number[] = [];
  const counts = { flushes: 0 };
  let clock = 0;
  let markWaiting: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => {
    markWaiting = resolve;
  });
  const metrics = createMetrics();

  const flusher = createTelemetryFlusher({
    flushManager: {
      flushOnce: () => {
        counts.flushes += 1;
        clock += options.msPerFlush ?? 0;
        const next = script.shift() ?? EMPTY;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    },
    metrics,
    logger: pino({ level: 'silent' }),
    batchSize: BATCH_SIZE,
    flushIntervalMs: INTERVAL_MS,
    now: () => clock,
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
  return { flusher, script, sleeps, counts, metrics, waiting };
}

describe('telemetry flusher loop', () => {
  it('flushes full batches back to back, and waits the interval once caught up', async () => {
    const { flusher, script, sleeps, counts, waiting } = setup();
    script.push(batchOf(BATCH_SIZE), batchOf(BATCH_SIZE), batchOf(3));

    flusher.start();
    await waiting;

    expect(counts.flushes).toBe(3);
    expect(sleeps).toEqual([INTERVAL_MS]); // no wait after a full batch: more may be queued
    await flusher.stop(1_000);
  });

  it('backs off exponentially while flushes fail, and starts over after a success', async () => {
    const { flusher, script, sleeps, metrics, waiting } = setup();
    script.push(OUTAGE, OUTAGE, OUTAGE, batchOf(1), OUTAGE, batchOf(1));

    flusher.start();
    await waiting;

    expect(sleeps).toEqual([500, 1_000, 2_000, INTERVAL_MS, 500, INTERVAL_MS]);
    expect(await counterValue(metrics.telemetryFlushFailures, { kind: 'transient' })).toBe(4);
    await flusher.stop(1_000);
  });

  it('counts an error that is not an outage as unexpected, and still retries', async () => {
    const { flusher, script, sleeps, metrics, waiting } = setup();
    script.push(new TypeError('a bug'), batchOf(1));

    flusher.start();
    await waiting;

    expect(sleeps).toEqual([500, INTERVAL_MS]);
    expect(await counterValue(metrics.telemetryFlushFailures, { kind: 'unexpected' })).toBe(1);
    await flusher.stop(1_000);
  });

  it('on stop, wakes up and drains back to back until the buffer is empty', async () => {
    const { flusher, script, sleeps, counts, waiting } = setup();
    flusher.start();
    await waiting; // idle, sleeping for the interval
    script.push(batchOf(BATCH_SIZE), batchOf(2)); // events arrived meanwhile

    await flusher.stop(5_000);

    expect(counts.flushes).toBe(4); // idle, full, partial, empty → drained
    expect(sleeps).toEqual([INTERVAL_MS]); // no waiting while draining
  });

  it('stops draining when a flush fails: the events stay in Redis', async () => {
    const { flusher, script, sleeps, counts, waiting } = setup();
    flusher.start();
    await waiting;
    script.push(OUTAGE, batchOf(1));

    await flusher.stop(5_000);

    expect(counts.flushes).toBe(2);
    expect(sleeps).toEqual([INTERVAL_MS]); // no backoff during shutdown
    expect(script).toEqual([batchOf(1)]); // never claimed
  });

  it('stops draining when the drain time is up', async () => {
    const { flusher, script, counts, waiting } = setup({ msPerFlush: 400 });
    flusher.start();
    await waiting; // first (empty) flush done at t = 400
    script.push(...Array.from({ length: 10 }, () => batchOf(BATCH_SIZE)));

    await flusher.stop(1_000); // deadline t = 1400: flushes end at 800, 1200, 1600

    expect(counts.flushes).toBe(4);
    expect(script).toHaveLength(7);
  });

  it('can be stopped without having started (startup failed)', async () => {
    const { flusher, counts } = setup();

    await flusher.stop(1_000);

    expect(counts.flushes).toBe(0);
  });
});
