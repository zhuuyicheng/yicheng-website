import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../../src/infra/metrics.js';
import type {
  ContactMessage,
  NewContactMessage,
} from '../../../src/schema/contact-message.schema.js';
import { notificationJobSchema } from '../../../src/schema/notification-job.schema.js';
import { createContactManager } from '../../../src/services/contact.manager.js';
import { counterValue } from '../../helpers/metrics.js';

const log = pino({ level: 'silent' });
const MESSAGE_ID = '0b9f8a6e-4c3d-4e2f-9a1b-7c6d5e4f3a2b';
const JOB_ID = '6f1c2b1e-8a3d-4b5c-9e7f-0a1b2c3d4e5f';
const REQUEST = { name: 'Ada', email: 'ada@example.com', message: 'Hello!' };
const SENDER = { ip: '203.0.113.7' };

function setup(options: { enqueueFails?: Error; insertFails?: Error } = {}) {
  const inserted: NewContactMessage[] = [];
  const queue: string[] = [];
  const metrics = createMetrics();
  const manager = createContactManager({
    contactMessageDal: {
      insert: (message) => {
        if (options.insertFails) return Promise.reject(options.insertFails);
        inserted.push(message);
        const stored: ContactMessage = {
          id: MESSAGE_ID,
          name: message.name,
          email: message.email,
          message: message.message,
          status: 'PENDING',
          attempts: 0,
          lastError: null,
          createdAt: new Date('2026-11-18T10:00:00.000Z'),
          sentAt: null,
        };
        return Promise.resolve(stored);
      },
    },
    notificationQueueDal: {
      enqueue: (jobJson) => {
        if (options.enqueueFails) return Promise.reject(options.enqueueFails);
        queue.push(jobJson);
        return Promise.resolve();
      },
    },
    hashIp: (ip) => `hash(${ip})`,
    metrics,
    now: () => new Date('2026-11-18T10:00:00.000Z'),
    newJobId: () => JOB_ID,
  });
  return { manager, inserted, queue, metrics };
}

describe('ContactManager.submit', () => {
  it('stores the message with the hashed IP, then queues a first-attempt job for it', async () => {
    const { manager, inserted, queue } = setup();

    const accepted = await manager.submit(REQUEST, SENDER, log);

    expect(accepted).toEqual({ id: MESSAGE_ID, status: 'PENDING' });
    expect(inserted).toEqual([{ ...REQUEST, ipHash: 'hash(203.0.113.7)' }]);
    expect(queue.map((job) => notificationJobSchema.parse(JSON.parse(job)))).toEqual([
      {
        jobId: JOB_ID,
        messageId: MESSAGE_ID,
        attempt: 1,
        enqueuedAt: '2026-11-18T10:00:00.000Z',
      },
    ]);
  });

  it('keeps the job free of personal data: ids only', async () => {
    const { manager, queue } = setup();

    await manager.submit(REQUEST, SENDER, log);

    expect(queue[0]).not.toContain('ada@example.com');
    expect(queue[0]).not.toContain('Hello!');
  });

  it('still accepts the message when queueing fails, and counts the failure', async () => {
    const outage = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const { manager, inserted, metrics } = setup({ enqueueFails: outage });

    const accepted = await manager.submit(REQUEST, SENDER, log);

    // The message is safe in Postgres; the reconciler will queue it later.
    expect(accepted).toEqual({ id: MESSAGE_ID, status: 'PENDING' });
    expect(inserted).toHaveLength(1);
    expect(await counterValue(metrics.notificationEnqueueFailures)).toBe(1);
  });

  it('queues nothing when the message could not be stored', async () => {
    const outage = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const { manager, queue } = setup({ insertFails: outage });

    await expect(manager.submit(REQUEST, SENDER, log)).rejects.toBe(outage);
    expect(queue).toEqual([]);
  });
});
