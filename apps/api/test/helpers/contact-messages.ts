import { randomUUID } from 'node:crypto';
import type { ContactMessage } from '../../src/schema/contact-message.schema.js';
import type { NotificationJob } from '../../src/schema/notification-job.schema.js';

/** A stored contact message, as the DAL returns it. */
export function contactMessage(overrides: Partial<ContactMessage> = {}): ContactMessage {
  return {
    id: '0b9f8a6e-4c3d-4e2f-9a1b-7c6d5e4f3a2b',
    name: 'Ada',
    email: 'ada@example.com',
    message: 'Hello!',
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    createdAt: new Date('2026-11-18T10:00:00.000Z'),
    sentAt: null,
    ...overrides,
  };
}

/** A valid notification job queue entry, exactly as the API writes one. */
export function notificationJobJson(overrides: Partial<NotificationJob> = {}): string {
  const job: NotificationJob = {
    jobId: randomUUID(),
    messageId: '0b9f8a6e-4c3d-4e2f-9a1b-7c6d5e4f3a2b',
    attempt: 1,
    enqueuedAt: '2026-11-18T10:00:00.000Z',
    ...overrides,
  };
  return JSON.stringify(job);
}
