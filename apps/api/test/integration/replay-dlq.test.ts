import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createContactMessageDal } from '../../src/dal/contact-message.dal.js';
import { TELEMETRY_BUFFER_KEYS } from '../../src/dal/event-buffer.dal.js';
import { NOTIFICATION_QUEUE_KEYS } from '../../src/dal/notification-queue.dal.js';
import type { ContactMessageRow } from '../../src/dao/contact-message.dao.js';
import { notificationJobSchema } from '../../src/schema/notification-job.schema.js';
import { notificationJobJson } from '../helpers/contact-messages.js';
import { bufferedEventJson } from '../helpers/telemetry-events.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';
import { integrationTestEnv } from './test-env.js';

const API_ROOT = path.resolve(import.meta.dirname, '../..');

/** Runs the real `dlq:replay` CLI against the test Redis DB. */
function runReplayCli(...args: string[]): Promise<number | null> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/replay-dlq.ts', ...args], {
    cwd: API_ROOT,
    env: { ...process.env, ...integrationTestEnv },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return new Promise((resolve) => {
    child.once('exit', resolve);
  });
}

function deadLetter(payload: string): string {
  return JSON.stringify({
    payload,
    reason: 'insert_failed',
    errorCode: '42P01',
    errorMessage: 'relation "analytics_events" does not exist',
    failedAt: new Date().toISOString(),
  });
}

describe('dlq:replay CLI', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  beforeEach(async () => {
    await deps.redis.flushdb(); // Redis DB 1 (tests) only
  });

  it('moves every dead-lettered event back into the buffer and exits 0', async () => {
    const events = [bufferedEventJson(), bufferedEventJson()];
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.deadLetter, ...events.map(deadLetter));

    expect(await runReplayCli('telemetry')).toBe(0);

    expect(await deps.redis.lrange(TELEMETRY_BUFFER_KEYS.buffer, 0, -1)).toEqual(events);
    expect(await deps.redis.llen(TELEMETRY_BUFFER_KEYS.deadLetter)).toBe(0);
  });

  it('leaves unreadable entries in the DLQ and exits 1', async () => {
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.deadLetter, 'garbage');

    expect(await runReplayCli('telemetry')).toBe(1);

    expect(await deps.redis.lrange(TELEMETRY_BUFFER_KEYS.deadLetter, 0, -1)).toEqual(['garbage']);
  });

  it('notifications: reopens FAILED messages with a fresh job and exits 0', async () => {
    await deps.postgres.query('TRUNCATE contact_messages');
    const dal = createContactMessageDal(deps.postgres);
    const message = await dal.insert({
      name: 'Ada',
      email: 'ada@example.com',
      message: 'Hello!',
      ipHash: 'a'.repeat(64),
    });
    await dal.markFailed(message.id, 3, 'Discord webhook answered 404');
    await deps.redis.rpush(
      NOTIFICATION_QUEUE_KEYS.deadLetter,
      JSON.stringify({
        payload: notificationJobJson({ messageId: message.id, attempt: 3 }),
        reason: 'rejected',
        error: 'Discord webhook answered 404',
        failedAt: new Date().toISOString(),
      }),
    );

    expect(await runReplayCli('notifications')).toBe(0);

    const rows = await deps.postgres.query<ContactMessageRow>(
      'SELECT * FROM contact_messages WHERE id = $1',
      [message.id],
    );
    expect(rows.rows[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    const jobs = await deps.redis.lrange(NOTIFICATION_QUEUE_KEYS.ready, 0, -1);
    expect(jobs.map((job) => notificationJobSchema.parse(JSON.parse(job)))).toEqual([
      expect.objectContaining({ messageId: message.id, attempt: 1 }),
    ]);
    expect(await deps.redis.llen(NOTIFICATION_QUEUE_KEYS.deadLetter)).toBe(0);
  });

  it('refuses to run without a known queue name', async () => {
    expect(await runReplayCli()).toBe(1);
    expect(await runReplayCli('emails')).toBe(1);
  });
});
