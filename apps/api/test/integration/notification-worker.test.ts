import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createContactMessageDal } from '../../src/dal/contact-message.dal.js';
import {
  createNotificationQueueDal,
  NOTIFICATION_QUEUE_KEYS,
} from '../../src/dal/notification-queue.dal.js';
import type { ContactMessageRow } from '../../src/dao/contact-message.dao.js';
import { createMetrics, type Metrics } from '../../src/infra/metrics.js';
import { createDiscordNotifier } from '../../src/infra/notifiers/discord.notifier.js';
import { createPostgresPool, type PostgresPool } from '../../src/infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient, type Redis } from '../../src/infra/redis.js';
import {
  deadLetteredJobSchema,
  notificationJobSchema,
} from '../../src/schema/notification-job.schema.js';
import { createNotificationManager } from '../../src/services/notification.manager.js';
import { notificationJobJson } from '../helpers/contact-messages.js';
import { counterValue } from '../helpers/metrics.js';
import { startStubWebhook, type StubWebhook } from '../helpers/stub-webhook.js';
import {
  createTestDependencies,
  UNREACHABLE_POSTGRES_URL,
  type TestDependencies,
} from '../helpers/test-dependencies.js';

/** Longer than the test backoff (10 ms, then 20 ms, ± 20 %). */
const WAIT_FOR_BACKOFF_MS = 60;

describe('notification worker with live Postgres, Redis and a stub webhook', () => {
  let deps: TestDependencies;
  let blockingRedis: Redis;
  let webhook: StubWebhook;

  beforeAll(async () => {
    deps = await createTestDependencies();
    blockingRedis = createRedisClient(
      { url: deps.config.redis.url, connectionName: 'portfolio-worker-blocking-test' },
      deps.logger,
      deps.metrics,
    );
    await connectRedis(blockingRedis);
    webhook = await startStubWebhook();
  });

  afterAll(async () => {
    await webhook.close();
    await closeRedis(blockingRedis);
    await deps.close();
  });

  beforeEach(async () => {
    await deps.redis.flushdb(); // Redis DB 1 (tests) only
    await deps.postgres.query('TRUNCATE contact_messages');
    webhook.statuses.length = 0;
    webhook.requests.length = 0;
  });

  /** The real manager, the stub webhook, and a 10 ms backoff. */
  function createManager(
    options: { postgres?: PostgresPool; metrics?: Metrics; now?: () => Date } = {},
  ) {
    return createNotificationManager({
      contactMessageDal: createContactMessageDal(options.postgres ?? deps.postgres),
      queueDal: createNotificationQueueDal(deps.redis, blockingRedis),
      notifier: createDiscordNotifier({ webhookUrl: webhook.url, timeoutMs: 2_000 }),
      metrics: options.metrics ?? createMetrics(),
      maxAttempts: 3,
      backoffBaseMs: 10,
      random: () => 0.5, // no jitter
      now: options.now ?? (() => new Date()),
    });
  }

  /** A PENDING message and its first job, as POST /api/v1/contact makes them. */
  async function queueMessage(): Promise<string> {
    const message = await createContactMessageDal(deps.postgres).insert({
      name: 'Ada',
      email: 'ada@example.com',
      message: 'Hello from the tests!',
      ipHash: 'a'.repeat(64),
    });
    await deps.redis.lpush(
      NOTIFICATION_QUEUE_KEYS.ready,
      notificationJobJson({ messageId: message.id }),
    );
    return message.id;
  }

  async function storedMessage(id: string): Promise<ContactMessageRow | undefined> {
    const result = await deps.postgres.query<ContactMessageRow>(
      'SELECT * FROM contact_messages WHERE id = $1',
      [id],
    );
    return result.rows[0];
  }

  async function queueLengths() {
    return {
      ready: await deps.redis.llen(NOTIFICATION_QUEUE_KEYS.ready),
      processing: await deps.redis.llen(NOTIFICATION_QUEUE_KEYS.processing),
      delayed: await deps.redis.zcard(NOTIFICATION_QUEUE_KEYS.delayed),
      dlq: await deps.redis.llen(NOTIFICATION_QUEUE_KEYS.deadLetter),
    };
  }

  /** Waits out the backoff, then lets the promoter move the retry to `ready`. */
  async function promoteRetry(manager: ReturnType<typeof createManager>): Promise<void> {
    await delay(WAIT_FOR_BACKOFF_MS);
    expect(await manager.promoteDue(deps.logger)).toBe(1);
  }

  it('end to end: a message sent to the API reaches the webhook and becomes SENT', async () => {
    const app = buildApp(deps);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/contact',
        payload: { name: 'Ada', email: 'ada@example.com', message: 'We have a role for you' },
      });
      const { id } = response.json<{ data: { id: string } }>().data;

      expect(await createManager().processNext(deps.logger)).toBe('sent');

      expect(webhook.requests).toEqual([
        expect.objectContaining({
          allowed_mentions: { parse: [] },
          embeds: [
            expect.objectContaining({
              title: 'New message from Ada',
              description: 'We have a role for you',
              fields: [{ name: 'Email', value: 'ada@example.com' }],
            }),
          ],
        }),
      ]);
      expect(await storedMessage(id)).toMatchObject({ status: 'SENT', attempts: 1 });
      expect((await storedMessage(id))?.sent_at).toBeInstanceOf(Date);
      expect(await queueLengths()).toEqual({ ready: 0, processing: 0, delayed: 0, dlq: 0 });
    } finally {
      await app.close();
    }
  });

  it('fails twice with 500, retries after a backoff, then succeeds: SENT on attempt 3', async () => {
    const id = await queueMessage();
    webhook.statuses.push(500, 500);
    // A hand-moved clock: with real time, a busy machine could pass the 10 ms backoff before the
    // "not due yet" check (a flaky test).
    let clockMs = Date.now();
    const manager = createManager({ now: () => new Date(clockMs) });

    expect(await manager.processNext(deps.logger)).toBe('retried');
    expect(await queueLengths()).toEqual({ ready: 0, processing: 0, delayed: 1, dlq: 0 });
    // Not due yet: the promoter leaves it alone.
    expect(await manager.promoteDue(deps.logger)).toBe(0);
    clockMs += 1_000; // well past the backoff
    expect(await manager.promoteDue(deps.logger)).toBe(1);
    expect(await manager.processNext(deps.logger)).toBe('retried');
    clockMs += 1_000;
    expect(await manager.promoteDue(deps.logger)).toBe(1);
    expect(await manager.processNext(deps.logger)).toBe('sent');

    expect(webhook.requests).toHaveLength(3);
    expect(await storedMessage(id)).toMatchObject({
      status: 'SENT',
      attempts: 3,
      last_error: expect.stringContaining('500') as unknown,
    });
    expect(await queueLengths()).toEqual({ ready: 0, processing: 0, delayed: 0, dlq: 0 });
  });

  it('always 500: gives up after 3 attempts, FAILED + DLQ (attempts_exhausted)', async () => {
    const id = await queueMessage();
    webhook.statuses.push(500, 500, 500);
    const metrics = createMetrics();
    const manager = createManager({ metrics });

    expect(await manager.processNext(deps.logger)).toBe('retried');
    await promoteRetry(manager);
    expect(await manager.processNext(deps.logger)).toBe('retried');
    await promoteRetry(manager);
    expect(await manager.processNext(deps.logger)).toBe('dead_lettered');

    expect(await storedMessage(id)).toMatchObject({ status: 'FAILED', attempts: 3, sent_at: null });
    const [entry] = await deps.redis.lrange(NOTIFICATION_QUEUE_KEYS.deadLetter, 0, -1);
    const deadLetter = deadLetteredJobSchema.parse(JSON.parse(entry ?? ''));
    expect(deadLetter.reason).toBe('attempts_exhausted');
    expect(deadLetter.error).toContain('500');
    expect(notificationJobSchema.parse(JSON.parse(deadLetter.payload)).attempt).toBe(3);
    expect(await queueLengths()).toEqual({ ready: 0, processing: 0, delayed: 0, dlq: 1 });
    expect(await counterValue(metrics.notificationJobs, { outcome: 'retried' })).toBe(2);
    expect(await counterValue(metrics.notificationJobs, { outcome: 'dead_lettered' })).toBe(1);
  });

  it('400: does not retry at all, FAILED + DLQ (rejected) after one attempt', async () => {
    const id = await queueMessage();
    webhook.statuses.push(400);

    expect(await createManager().processNext(deps.logger)).toBe('dead_lettered');

    expect(webhook.requests).toHaveLength(1);
    expect(await storedMessage(id)).toMatchObject({ status: 'FAILED', attempts: 1 });
    const [entry] = await deps.redis.lrange(NOTIFICATION_QUEUE_KEYS.deadLetter, 0, -1);
    expect(deadLetteredJobSchema.parse(JSON.parse(entry ?? '')).reason).toBe('rejected');
  });

  it('recovers a job a crashed worker left in processing', async () => {
    const id = await queueMessage();
    // A previous worker took the job, then died.
    await deps.redis.lmove(
      NOTIFICATION_QUEUE_KEYS.ready,
      NOTIFICATION_QUEUE_KEYS.processing,
      'RIGHT',
      'LEFT',
    );
    const metrics = createMetrics();

    expect(await createManager({ metrics }).processNext(deps.logger)).toBe('sent');

    expect(await storedMessage(id)).toMatchObject({ status: 'SENT' });
    expect(await queueLengths()).toEqual({ ready: 0, processing: 0, delayed: 0, dlq: 0 });
    expect(await counterValue(metrics.notificationJobsRequeued, { reason: 'stranded' })).toBe(1);
  });

  it('skips a repeated job for a message that is already SENT (no second notification)', async () => {
    const id = await queueMessage();
    const manager = createManager();
    expect(await manager.processNext(deps.logger)).toBe('sent');
    // Queued again (crash after sending, or a reconciler re-queue).
    await deps.redis.lpush(NOTIFICATION_QUEUE_KEYS.ready, notificationJobJson({ messageId: id }));

    expect(await manager.processNext(deps.logger)).toBe('skipped');

    expect(webhook.requests).toHaveLength(1);
  });

  it('Postgres down mid-job: the job stays in processing and keeps all its attempts', async () => {
    const id = await queueMessage();
    const deadPostgres = createPostgresPool(
      { url: UNREACHABLE_POSTGRES_URL, poolMax: 1, applicationName: 'dead-postgres' },
      deps.logger,
      deps.metrics,
    );

    try {
      await expect(
        createManager({ postgres: deadPostgres }).processNext(deps.logger),
      ).rejects.toThrow();
      expect(await queueLengths()).toEqual({ ready: 0, processing: 1, delayed: 0, dlq: 0 });
    } finally {
      await deadPostgres.end();
    }

    // Postgres is back: the job is put back and sent, on attempt 1.
    expect(await createManager().processNext(deps.logger)).toBe('sent');
    expect(await storedMessage(id)).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  it('reconciler: re-queues a PENDING message left without a job for over 5 minutes', async () => {
    const lost = await queueMessage();
    await queueMessage(); // recent: not stale yet, so left alone
    await deps.redis.del(NOTIFICATION_QUEUE_KEYS.ready); // both jobs lost
    await deps.postgres.query(
      `UPDATE contact_messages SET updated_at = now() - interval '10 minutes' WHERE id = $1`,
      [lost],
    );
    const manager = createManager();

    expect(await manager.reconcile(deps.logger)).toBe(1);

    const jobs = await deps.redis.lrange(NOTIFICATION_QUEUE_KEYS.ready, 0, -1);
    expect(jobs.map((job) => notificationJobSchema.parse(JSON.parse(job)))).toEqual([
      expect.objectContaining({ messageId: lost, attempt: 1 }),
    ]);
    // Claimed: updated_at was bumped, so the next run skips it.
    expect(await manager.reconcile(deps.logger)).toBe(0);
  });

  it('promoter: moves only the delayed jobs that are due', async () => {
    const now = Date.now();
    const due = notificationJobJson({ jobId: randomUUID(), attempt: 2 });
    const later = notificationJobJson({ jobId: randomUUID(), attempt: 2 });
    await deps.redis.zadd(NOTIFICATION_QUEUE_KEYS.delayed, now - 1, due);
    await deps.redis.zadd(NOTIFICATION_QUEUE_KEYS.delayed, now + 60_000, later);

    expect(await createManager().promoteDue(deps.logger)).toBe(1);

    expect(await deps.redis.lrange(NOTIFICATION_QUEUE_KEYS.ready, 0, -1)).toEqual([due]);
    expect(await deps.redis.zrange(NOTIFICATION_QUEUE_KEYS.delayed, 0, '-1')).toEqual([later]);
  });
});
