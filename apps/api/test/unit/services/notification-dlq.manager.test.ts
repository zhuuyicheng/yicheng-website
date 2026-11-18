import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { notificationJobSchema } from '../../../src/schema/notification-job.schema.js';
import { createNotificationDlqManager } from '../../../src/services/notification-dlq.manager.js';
import { notificationJobJson } from '../../helpers/contact-messages.js';

const log = pino({ level: 'silent' });

function deadLetter(payload: string): string {
  return JSON.stringify({
    payload,
    reason: 'rejected',
    error: 'Discord webhook answered 404',
    failedAt: '2026-11-18T12:00:00.000Z',
  });
}

describe('NotificationDlqManager.replay', () => {
  it('reopens each message, queues a fresh first-attempt job, and leaves unreadable entries', async () => {
    const messageId = '0b9f8a6e-4c3d-4e2f-9a1b-7c6d5e4f3a2b';
    const dlq = [
      deadLetter(notificationJobJson({ messageId, attempt: 3 })),
      deadLetter('not a job'), // an invalid_payload dead letter: nothing to replay
      'garbage',
    ];
    const reopened: string[] = [];
    const queued: string[] = [];
    const manager = createNotificationDlqManager({
      queueDal: {
        listDeadLetters: () => Promise.resolve([...dlq]),
        replayDeadLetter: (entry, jobJson) => {
          queued.push(jobJson);
          dlq.splice(dlq.indexOf(entry), 1);
          return Promise.resolve();
        },
      },
      contactMessageDal: {
        reopenFailed: (id) => {
          reopened.push(id);
          return Promise.resolve();
        },
      },
      now: () => new Date('2026-11-18T13:00:00.000Z'),
      newJobId: () => '6f1c2b1e-8a3d-4b5c-9e7f-0a1b2c3d4e5f',
    });

    expect(await manager.replay(log)).toEqual({ replayed: 1, unreadable: 2 });
    expect(reopened).toEqual([messageId]);
    expect(queued.map((job) => notificationJobSchema.parse(JSON.parse(job)))).toEqual([
      {
        jobId: '6f1c2b1e-8a3d-4b5c-9e7f-0a1b2c3d4e5f',
        messageId,
        attempt: 1, // a full set of attempts again
        enqueuedAt: '2026-11-18T13:00:00.000Z',
      },
    ]);
    expect(dlq).toHaveLength(2);
  });
});
