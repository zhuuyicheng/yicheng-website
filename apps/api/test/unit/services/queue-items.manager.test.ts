import { queueItemsSchema } from '@portfolio/shared';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { ContactMessage } from '../../../src/schema/contact-message.schema.js';
import type { QueuePeek } from '../../../src/schema/queue-items.schema.js';
import {
  createQueueItemsManager,
  RAW_PREVIEW_CHARS,
} from '../../../src/services/queue-items.manager.js';
import { contactMessage, notificationJobJson } from '../../helpers/contact-messages.js';
import { bufferedEventJson } from '../../helpers/telemetry-events.js';

const log = pino({ level: 'silent' });
const NOW = new Date('2026-11-23T12:00:00.000Z');
const ADA = '0b9f8a6e-4c3d-4e2f-9a1b-7c6d5e4f3a2b';
const BOB = '7d3c2b1a-0f9e-4d8c-b7a6-5e4d3c2b1a0f';

const peek = (...entries: string[]): QueuePeek => ({ total: entries.length + 10, entries });
const nothing = (): Promise<QueuePeek> => Promise.resolve(peek());

function manager(options: {
  buffer?: QueuePeek;
  eventDlq?: QueuePeek;
  ready?: QueuePeek;
  delayed?: QueuePeek<{ entry: string; dueAtMs: number }>;
  jobDlq?: QueuePeek;
  messages?: ContactMessage[];
}) {
  const findByIds = vi.fn((ids: readonly string[]) =>
    Promise.resolve((options.messages ?? []).filter((message) => ids.includes(message.id))),
  );
  const queueItems = createQueueItemsManager({
    bufferDal: {
      peekBuffer: () => (options.buffer ? Promise.resolve(options.buffer) : nothing()),
      peekDeadLetters: () => (options.eventDlq ? Promise.resolve(options.eventDlq) : nothing()),
    },
    queueDal: {
      peekReady: () => (options.ready ? Promise.resolve(options.ready) : nothing()),
      peekDelayed: () => Promise.resolve(options.delayed ?? { total: 0, entries: [] }),
      peekDeadLetters: () => (options.jobDlq ? Promise.resolve(options.jobDlq) : nothing()),
    },
    contactMessageDal: { findByIds },
    now: () => NOW,
  });
  return { queueItems, findByIds };
}

describe('QueueItemsManager.getItems', () => {
  it('shows buffered visits as the owner reads them, in the order the DAL gives (newest first)', async () => {
    const newest = bufferedEventJson({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      type: 'interaction',
      name: 'click:linkedin',
      path: '/',
      receivedAt: '2026-11-23T11:59:00.000Z',
      referrerHost: 'www.linkedin.com',
      network: { countryCode: 'SG', city: 'Singapore', organization: 'Acme Pte Ltd' },
      device: { browser: 'Chrome', os: 'macOS', type: 'desktop', language: null, timezone: null },
    });
    const older = bufferedEventJson({ path: '/bowling-buddy' });
    const { queueItems, findByIds } = manager({ buffer: peek(newest, older) });

    const result = await queueItems.getItems('telemetryBuffer', 20, log);

    expect(queueItemsSchema.parse(result)).toEqual(result); // the shared contract
    expect(result).toMatchObject({
      queue: 'telemetryBuffer',
      total: 12,
      generatedAt: NOW.toISOString(),
    });
    expect(result.items[0]).toEqual({
      kind: 'event',
      event: {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        type: 'interaction',
        name: 'click:linkedin',
        path: '/',
        receivedAt: '2026-11-23T11:59:00.000Z',
        referrer: 'www.linkedin.com',
        organization: 'Acme Pte Ltd',
        city: 'Singapore',
        countryCode: 'SG',
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'macOS',
      },
      deadLetter: null,
      raw: null,
    });
    expect(result.items[1]).toMatchObject({ kind: 'event', event: { path: '/bowling-buddy' } });
    expect(findByIds).not.toHaveBeenCalled(); // visits never need the database
  });

  it('shows why each visit was dead-lettered, and the start of what could not be read', async () => {
    const refused = JSON.stringify({
      payload: bufferedEventJson({ path: '/x' }),
      reason: 'insert_failed',
      errorCode: '23514',
      errorMessage: 'new row violates check constraint "analytics_events_path_check"',
      failedAt: '2026-11-23T10:00:00.000Z',
    });
    const unreadablePayload = JSON.stringify({
      payload: 'not json',
      reason: 'invalid_payload',
      errorCode: null,
      errorMessage: 'Unexpected token',
      failedAt: '2026-11-23T09:00:00.000Z',
    });
    const { queueItems } = manager({ eventDlq: peek(refused, unreadablePayload, 'garbage') });

    const { items } = await queueItems.getItems('telemetryDeadLetter', 20, log);

    expect(items[0]).toMatchObject({
      event: { path: '/x' },
      deadLetter: {
        reason: 'insert_failed',
        error: 'new row violates check constraint "analytics_events_path_check"',
        errorCode: '23514',
        failedAt: '2026-11-23T10:00:00.000Z',
      },
      raw: null,
    });
    expect(items[1]).toMatchObject({
      event: null,
      deadLetter: { reason: 'invalid_payload', errorCode: null },
      raw: 'not json',
    });
    // Not even a dead letter: shown as it is.
    expect(items[2]).toEqual({ kind: 'event', event: null, deadLetter: null, raw: 'garbage' });
  });

  it('shows whose message each notification is about, with one database query for all', async () => {
    const { queueItems, findByIds } = manager({
      ready: peek(
        notificationJobJson({ messageId: BOB }),
        notificationJobJson({ messageId: ADA }),
        notificationJobJson({ messageId: ADA }), // a duplicate job: delivery is at least once
        notificationJobJson({ messageId: '9e8d7c6b-5a4f-4e3d-a2c1-b0a9f8e7d6c5' }), // deleted
        '{"jobId":1}',
      ),
      messages: [
        contactMessage({ id: ADA }),
        contactMessage({ id: BOB, name: 'Bob', email: 'bob@example.com' }),
      ],
    });

    const result = await queueItems.getItems('notificationsReady', 20, log);

    expect(queueItemsSchema.parse(result)).toEqual(result);
    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findByIds.mock.calls[0]?.[0]).toHaveLength(3); // each message once
    expect(result.items[0]).toEqual({
      kind: 'notification',
      attempt: 1,
      dueAt: null,
      message: {
        id: BOB,
        name: 'Bob',
        email: 'bob@example.com',
        message: 'Hello!',
        status: 'PENDING',
        lastError: null,
        createdAt: '2026-11-18T10:00:00.000Z',
      },
      deadLetter: null,
      raw: null,
    });
    expect(result.items[1]).toMatchObject({ message: { name: 'Ada' } });
    expect(result.items[3]).toMatchObject({ attempt: 1, message: null, raw: null });
    expect(result.items[4]).toMatchObject({ attempt: null, message: null, raw: '{"jobId":1}' });
  });

  it('says when each waiting retry is due', async () => {
    const dueAtMs = Date.parse('2026-11-23T12:00:30.000Z');
    const { queueItems } = manager({
      delayed: {
        total: 1,
        entries: [{ entry: notificationJobJson({ messageId: ADA, attempt: 2 }), dueAtMs }],
      },
      messages: [contactMessage({ id: ADA, attempts: 1, lastError: 'Discord timed out' })],
    });

    const { items } = await queueItems.getItems('notificationsDelayed', 20, log);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      attempt: 2,
      dueAt: '2026-11-23T12:00:30.000Z',
      message: { lastError: 'Discord timed out' }, // why the last try failed
    });
  });

  it('shows why each notification gave up, and keeps an unreadable job as text', async () => {
    const rejected = JSON.stringify({
      payload: notificationJobJson({ messageId: ADA, attempt: 1 }),
      reason: 'rejected',
      error: 'Discord webhook answered 404',
      failedAt: '2026-11-23T08:00:00.000Z',
    });
    const corrupt = JSON.stringify({
      payload: 'not a job',
      reason: 'invalid_payload',
      error: 'job is not valid JSON',
      failedAt: '2026-11-23T07:00:00.000Z',
    });
    const { queueItems } = manager({
      jobDlq: peek(rejected, corrupt),
      messages: [contactMessage({ id: ADA, status: 'FAILED' })],
    });

    const { items } = await queueItems.getItems('notificationsDeadLetter', 20, log);

    expect(items[0]).toMatchObject({
      attempt: 1,
      message: { id: ADA, status: 'FAILED' },
      deadLetter: {
        reason: 'rejected',
        error: 'Discord webhook answered 404',
        errorCode: null,
        failedAt: '2026-11-23T08:00:00.000Z',
      },
      raw: null,
    });
    expect(items[1]).toMatchObject({
      attempt: null,
      message: null,
      deadLetter: { reason: 'invalid_payload' },
      raw: 'not a job',
    });
  });

  it('cuts long unreadable entries short, and logs where they are (never what they say)', async () => {
    const long = 'x'.repeat(RAW_PREVIEW_CHARS + 50);
    const warn = vi.fn();
    const spyLog = Object.assign(pino({ level: 'silent' }), { warn });
    const { queueItems } = manager({ buffer: peek(bufferedEventJson(), long) });

    const { items } = await queueItems.getItems('telemetryBuffer', 20, spyLog);

    expect(items[1]?.raw).toBe(`${'x'.repeat(RAW_PREVIEW_CHARS)}…`);
    expect(warn).toHaveBeenCalledWith(
      { queue: 'telemetryBuffer', positions: [1] },
      'unreadable queue entries shown as raw text',
    );
  });
});
