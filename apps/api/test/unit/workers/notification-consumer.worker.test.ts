import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../../src/infra/metrics.js';
import type { ProcessOutcome } from '../../../src/services/notification.manager.js';
import { createNotificationConsumer } from '../../../src/workers/notification-consumer.worker.js';
import { counterValue } from '../../helpers/metrics.js';

const OUTAGE = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

/**
 * The real loop against a scripted `processNext`. When the script runs out it "waits for a
 * job" like BLMOVE, until interruptWait() fails it; `waiting` resolves then.
 */
function setup() {
  const script: (ProcessOutcome | Error)[] = [];
  const sleeps: number[] = [];
  const counts = { processNext: 0, interrupts: 0 };
  const metrics = createMetrics();
  let failPendingWait: (() => void) | null = null;
  let markWaiting: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => {
    markWaiting = resolve;
  });

  const consumer = createNotificationConsumer({
    notificationManager: {
      processNext: () => {
        counts.processNext += 1;
        const next = script.shift();
        if (next === undefined) {
          markWaiting();
          return new Promise<ProcessOutcome>((_resolve, reject) => {
            failPendingWait = () => {
              reject(new Error('Connection is closed.'));
            };
          });
        }
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    },
    metrics,
    logger: pino({ level: 'silent' }),
    interruptWait: () => {
      counts.interrupts += 1;
      failPendingWait?.();
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { consumer, script, sleeps, counts, metrics, waiting };
}

describe('notification consumer loop', () => {
  it('runs jobs back to back, never sleeping between them', async () => {
    const { consumer, script, sleeps, counts, waiting } = setup();
    script.push('sent', 'skipped', 'idle', 'retried');

    consumer.start();
    await waiting;

    expect(counts.processNext).toBe(5); // 4 scripted + the one now waiting for a job
    expect(sleeps).toEqual([]); // processNext itself waits for the next job
    await consumer.stop();
  });

  it('backs off exponentially while processNext fails, and starts over after a success', async () => {
    const { consumer, script, sleeps, metrics, waiting } = setup();
    script.push(OUTAGE, OUTAGE, OUTAGE, 'sent', new TypeError('a bug'), 'sent');

    consumer.start();
    await waiting;

    expect(sleeps).toEqual([500, 1_000, 2_000, 500]);
    const failures = (kind: string) =>
      counterValue(metrics.workerLoopFailures, { loop: 'notification-consumer', kind });
    expect(await failures('transient')).toBe(3);
    expect(await failures('unexpected')).toBe(1);
    await consumer.stop();
  });

  it('on stop, interrupts the wait for a job: no 5 s delay, and not counted as a failure', async () => {
    const { consumer, counts, metrics, waiting } = setup();
    consumer.start();
    await waiting;

    await consumer.stop();

    expect(counts.interrupts).toBe(1);
    expect(await counterValue(metrics.workerLoopFailures)).toBe(0);
  });

  it('stop() before start() does nothing', async () => {
    const { consumer, counts } = setup();

    await consumer.stop();

    expect(counts.processNext).toBe(0);
  });
});
