import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { StalePendingMessage } from '../../../src/dal/contact-message.dal.js';
import { createMetrics } from '../../../src/infra/metrics.js';
import { NotificationError } from '../../../src/infra/notifiers/notifier.js';
import type { ContactMessage } from '../../../src/schema/contact-message.schema.js';
import {
  deadLetteredJobSchema,
  notificationJobSchema,
} from '../../../src/schema/notification-job.schema.js';
import {
  createNotificationManager,
  MAX_RETRY_DELAY_MS,
  retryDelayMs,
} from '../../../src/services/notification.manager.js';
import { contactMessage, notificationJobJson } from '../../helpers/contact-messages.js';
import { counterValue } from '../../helpers/metrics.js';

const log = pino({ level: 'silent' });
const NOW = new Date('2026-11-18T12:00:00.000Z');
const OUTAGE = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

interface SetupOptions {
  /** Queue entries `take` returns, in order; then `null` (nothing arrived). */
  queued?: string[];
  /** The message `findById` returns. */
  message?: ContactMessage | null;
  /** What the notifier does: succeed, or throw this. */
  notifierFails?: Error;
  markSentFails?: Error;
  stranded?: number;
  stale?: StalePendingMessage[];
}

/** A manager over in-memory fake DALs that record every call. */
function setup(options: SetupOptions = {}) {
  const queued = [...(options.queued ?? [])];
  const calls = {
    sent: [] as unknown[],
    notified: [] as string[],
    completed: [] as string[],
    retried: [] as { job: string; next: string; runAtMs: number }[],
    deadLettered: [] as { job: string; deadLetter: string }[],
    failedAttempts: [] as unknown[],
    failed: [] as unknown[],
    enqueued: [] as string[],
    promoted: [] as unknown[],
  };
  const metrics = createMetrics();
  const message = options.message === undefined ? contactMessage() : options.message;

  const manager = createNotificationManager({
    contactMessageDal: {
      findById: () => Promise.resolve(message),
      markSent: (id, attempt) => {
        if (options.markSentFails) return Promise.reject(options.markSentFails);
        calls.sent.push({ id, attempt });
        return Promise.resolve();
      },
      recordFailedAttempt: (id, attempt, error) => {
        calls.failedAttempts.push({ id, attempt, error });
        return Promise.resolve();
      },
      markFailed: (id, attempt, error) => {
        calls.failed.push({ id, attempt, error });
        return Promise.resolve();
      },
      claimStalePending: () => Promise.resolve(options.stale ?? []),
    },
    queueDal: {
      take: () => Promise.resolve(queued.shift() ?? null),
      complete: (job) => {
        calls.completed.push(job);
        return Promise.resolve();
      },
      retryLater: (job, next, runAtMs) => {
        calls.retried.push({ job, next, runAtMs });
        return Promise.resolve();
      },
      deadLetter: (job, deadLetter) => {
        calls.deadLettered.push({ job, deadLetter });
        return Promise.resolve();
      },
      requeueStranded: () => Promise.resolve(options.stranded ?? 0),
      promoteDue: (nowMs, maxJobs) => {
        calls.promoted.push({ nowMs, maxJobs });
        return Promise.resolve(2);
      },
      enqueue: (job) => {
        calls.enqueued.push(job);
        return Promise.resolve();
      },
    },
    notifier: {
      driver: 'discord',
      send: (sent) => {
        calls.notified.push(sent.id);
        return options.notifierFails ? Promise.reject(options.notifierFails) : Promise.resolve();
      },
    },
    metrics,
    maxAttempts: 3,
    backoffBaseMs: 5_000,
    now: () => NOW,
    random: () => 0.5, // no jitter: delays are exactly base × 2^(attempt − 1)
    newJobId: () => '6f1c2b1e-8a3d-4b5c-9e7f-0a1b2c3d4e5f',
  });
  return { manager, calls, metrics };
}

const retryable = new NotificationError('Discord webhook answered 503', { retryable: true });
const rejected = new NotificationError('Discord webhook answered 404', { retryable: false });

describe('retryDelayMs', () => {
  it('doubles per attempt from the base', () => {
    const noJitter = () => 0.5;
    expect([1, 2, 3].map((attempt) => retryDelayMs(attempt, 5_000, noJitter))).toEqual([
      5_000, 10_000, 20_000,
    ]);
  });

  it('adds at most ±20 % jitter', () => {
    expect(retryDelayMs(1, 5_000, () => 0)).toBe(4_000);
    expect(retryDelayMs(1, 5_000, () => 0.999_999)).toBe(6_000);
  });

  it('never waits longer than the cap, which stays below the reconciler’s 5 minutes', () => {
    expect(retryDelayMs(10, 60_000, () => 0.5)).toBe(MAX_RETRY_DELAY_MS);
    expect(MAX_RETRY_DELAY_MS).toBeLessThan(5 * 60 * 1000);
  });
});

describe('NotificationManager.processNext', () => {
  it('reports idle when no job arrives within the wait', async () => {
    const { manager, calls } = setup();

    expect(await manager.processNext(log)).toBe('idle');
    expect(calls.notified).toEqual([]);
  });

  it('sends, marks the message SENT on this attempt, and removes the job', async () => {
    const job = notificationJobJson({ attempt: 2 });
    const { manager, calls, metrics } = setup({ queued: [job] });

    expect(await manager.processNext(log)).toBe('sent');

    expect(calls.notified).toEqual([contactMessage().id]);
    expect(calls.sent).toEqual([{ id: contactMessage().id, attempt: 2 }]);
    expect(calls.completed).toEqual([job]);
    expect(await counterValue(metrics.notificationJobs, { outcome: 'sent' })).toBe(1);
  });

  it('schedules a retryable failure as the next attempt, after the backoff', async () => {
    const job = notificationJobJson({ attempt: 1 });
    const { manager, calls } = setup({ queued: [job], notifierFails: retryable });

    expect(await manager.processNext(log)).toBe('retried');

    expect(calls.failedAttempts).toEqual([
      { id: contactMessage().id, attempt: 1, error: 'Discord webhook answered 503' },
    ]);
    const [retry] = calls.retried;
    expect(retry?.job).toBe(job);
    expect(retry?.runAtMs).toBe(NOW.getTime() + 5_000);
    expect(notificationJobSchema.parse(JSON.parse(retry?.next ?? ''))).toMatchObject({
      jobId: notificationJobSchema.parse(JSON.parse(job)).jobId, // same job, one attempt further
      attempt: 2,
    });
    expect(calls.deadLettered).toEqual([]);
  });

  it('gives up after NOTIFY_MAX_ATTEMPTS: FAILED + DLQ (attempts_exhausted)', async () => {
    const job = notificationJobJson({ attempt: 3 });
    const { manager, calls, metrics } = setup({ queued: [job], notifierFails: retryable });

    expect(await manager.processNext(log)).toBe('dead_lettered');

    expect(calls.failed).toEqual([
      { id: contactMessage().id, attempt: 3, error: 'Discord webhook answered 503' },
    ]);
    expect(calls.retried).toEqual([]);
    const deadLetter = deadLetteredJobSchema.parse(
      JSON.parse(calls.deadLettered[0]?.deadLetter ?? ''),
    );
    expect(deadLetter).toMatchObject({ payload: job, reason: 'attempts_exhausted' });
    expect(await counterValue(metrics.notificationJobs, { outcome: 'dead_lettered' })).toBe(1);
  });

  it('dead-letters a non-retryable failure right away (rejected)', async () => {
    const { manager, calls } = setup({ queued: [notificationJobJson()], notifierFails: rejected });

    expect(await manager.processNext(log)).toBe('dead_lettered');

    expect(calls.retried).toEqual([]);
    expect(JSON.parse(calls.deadLettered[0]?.deadLetter ?? '')).toMatchObject({
      reason: 'rejected',
    });
  });

  it('treats a crash inside the notifier (a bug) as not retryable', async () => {
    const { manager, calls } = setup({
      queued: [notificationJobJson()],
      notifierFails: new TypeError('cannot read properties of undefined'),
    });

    expect(await manager.processNext(log)).toBe('dead_lettered');

    expect(calls.failed).toEqual([
      expect.objectContaining({ error: 'notifier crashed: cannot read properties of undefined' }),
    ]);
  });

  it.each([
    ['already SENT (a repeated job)', contactMessage({ status: 'SENT' })],
    ['FAILED', contactMessage({ status: 'FAILED' })],
    ['deleted', null],
  ])('skips a job whose message is %s, without notifying', async (_label, message) => {
    const job = notificationJobJson();
    const { manager, calls, metrics } = setup({ queued: [job], message });

    expect(await manager.processNext(log)).toBe('skipped');

    expect(calls.notified).toEqual([]);
    expect(calls.completed).toEqual([job]);
    expect(await counterValue(metrics.notificationJobs, { outcome: 'skipped' })).toBe(1);
  });

  it.each([['not json'], ['{"jobId":"x"}']])(
    'dead-letters an unreadable job: %s',
    async (entry) => {
      const { manager, calls } = setup({ queued: [entry] });

      expect(await manager.processNext(log)).toBe('dead_lettered');

      expect(calls.notified).toEqual([]);
      expect(JSON.parse(calls.deadLettered[0]?.deadLetter ?? '')).toMatchObject({
        payload: entry,
        reason: 'invalid_payload',
      });
    },
  );

  it('lets an outage after sending escape: the job stays in processing, no attempt used', async () => {
    const { manager, calls } = setup({ queued: [notificationJobJson()], markSentFails: OUTAGE });

    await expect(manager.processNext(log)).rejects.toBe(OUTAGE);

    // Not completed, not retried, not dead-lettered: the consumer puts it back later.
    expect(calls.completed).toEqual([]);
    expect(calls.retried).toEqual([]);
    expect(calls.deadLettered).toEqual([]);
  });

  it('first puts back jobs stranded in processing, and counts them', async () => {
    const { manager, metrics } = setup({ stranded: 1 });

    await manager.processNext(log);

    expect(await counterValue(metrics.notificationJobsRequeued, { reason: 'stranded' })).toBe(1);
  });
});

describe('NotificationManager.reconcile and promoteDue', () => {
  it('re-queues each stale PENDING message as its next attempt', async () => {
    const { manager, calls, metrics } = setup({
      stale: [{ id: '0b9f8a6e-4c3d-4e2f-9a1b-7c6d5e4f3a2b', attempts: 1 }],
    });

    expect(await manager.reconcile(log)).toBe(1);

    expect(calls.enqueued.map((job) => notificationJobSchema.parse(JSON.parse(job)))).toEqual([
      {
        jobId: '6f1c2b1e-8a3d-4b5c-9e7f-0a1b2c3d4e5f', // a new job
        messageId: '0b9f8a6e-4c3d-4e2f-9a1b-7c6d5e4f3a2b',
        attempt: 2,
        enqueuedAt: NOW.toISOString(),
      },
    ]);
    expect(await counterValue(metrics.notificationJobsRequeued, { reason: 'reconciled' })).toBe(1);
  });

  it('promotes jobs due by now', async () => {
    const { manager, calls } = setup();

    expect(await manager.promoteDue(log)).toBe(2);
    expect(calls.promoted).toEqual([{ nowMs: NOW.getTime(), maxJobs: 100 }]);
  });
});
