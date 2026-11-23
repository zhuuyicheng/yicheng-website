import {
  deadLetterReasonSchema,
  type QueueItem,
  type QueueItems,
  type QueuedEvent,
} from '@portfolio/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  clipText,
  DEAD_LETTER_HELP,
  deadLetterReasons,
  eventLabel,
  eventSource,
  fetchQueueItems,
  formatWhen,
  replayCommands,
  shownLabel,
} from '@/lib/queue-items';

const EVENT: QueuedEvent = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  type: 'page_view',
  name: null,
  path: '/bowling-buddy',
  receivedAt: '2026-11-23T11:59:03.000Z',
  referrer: null,
  organization: null,
  city: null,
  countryCode: null,
  deviceType: null,
  browser: null,
  os: null,
};

const REFUSED: QueueItem = {
  kind: 'event',
  event: EVENT,
  deadLetter: {
    reason: 'insert_failed',
    error: 'new row violates check constraint',
    errorCode: '23514',
    failedAt: '2026-11-23T12:00:00.000Z',
  },
  raw: null,
};

const ITEMS: QueueItems = {
  queue: 'telemetryDeadLetter',
  total: 1,
  items: [REFUSED],
  generatedAt: '2026-11-23T12:01:00.000Z',
};

const respond = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

const deadLetter = (reason: 'rejected' | 'attempts_exhausted'): QueueItem => ({
  kind: 'notification',
  attempt: 1,
  dueAt: null,
  message: null,
  deadLetter: { reason, error: 'x', errorCode: null, failedAt: '2026-11-23T12:00:00.000Z' },
  raw: null,
});

describe('fetchQueueItems', () => {
  it('reads one queue through the owner route, checked against the shared contract', async () => {
    const fetch = respond(200, { data: ITEMS });

    expect(await fetchQueueItems({ queue: 'telemetryDeadLetter', fetch })).toEqual(ITEMS);
    expect(fetch).toHaveBeenCalledWith('/admin/queues/telemetryDeadLetter', { cache: 'no-store' });
  });

  it('throws on an error status or an unexpected body, so the card offers to try again', async () => {
    await expect(
      fetchQueueItems({ queue: 'telemetryBuffer', fetch: respond(500, {}) }),
    ).rejects.toThrow('500');
    await expect(
      fetchQueueItems({ queue: 'telemetryBuffer', fetch: respond(200, { data: { items: 1 } }) }),
    ).rejects.toThrow('unexpected');
  });
});

describe('dead letters', () => {
  it('explain every reason the worker can give, with what to fix first', () => {
    for (const reason of deadLetterReasonSchema.options) {
      expect(DEAD_LETTER_HELP[reason].label).not.toBe('');
      expect(DEAD_LETTER_HELP[reason].fix).toMatch(/retry/);
    }
  });

  it('give one hint per reason present, in the order they first appear', () => {
    const items = [
      deadLetter('rejected'),
      deadLetter('attempts_exhausted'),
      deadLetter('rejected'),
      { ...deadLetter('rejected'), deadLetter: null },
    ];
    expect(deadLetterReasons(items)).toEqual(['rejected', 'attempts_exhausted']);
    expect(deadLetterReasons([])).toEqual([]);
  });

  it('come with the retry command for the server and for your computer', () => {
    expect(replayCommands('telemetry')).toEqual({
      server: 'docker compose -f ~/portfolio/deploy/compose.prod.yml run --rm replay-dlq telemetry',
      local: 'npm run dlq:replay -- telemetry',
    });
  });
});

describe('describing a visit', () => {
  it('says what it was: a page view or a click', () => {
    expect(eventLabel(EVENT)).toBe('Page view of /bowling-buddy');
    expect(eventLabel({ type: 'interaction', name: 'click:linkedin', path: '/' })).toBe(
      'Click on linkedin (on /)',
    );
    expect(eventLabel({ type: 'interaction', name: null, path: '/' })).toBe(
      'Click on a link (on /)',
    );
  });

  it('says who it was, leaving out what is unknown', () => {
    expect(
      eventSource({
        ...EVENT,
        organization: 'Acme Pte Ltd',
        countryCode: 'SG',
        city: 'Singapore',
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'macOS',
        referrer: 'www.linkedin.com',
      }),
    ).toBe('Acme Pte Ltd · Singapore · Desktop · Chrome · macOS · via linkedin.com');
    expect(eventSource({ ...EVENT, countryCode: 'US' })).toBe('United States');
    expect(eventSource(EVENT)).toBe('Nothing known about the visitor');
  });
});

describe('the list', () => {
  it('says which items it shows', () => {
    const items = (shown: number) => Array.from({ length: shown }, () => REFUSED);
    expect(shownLabel({ queue: 'telemetryBuffer', total: 0, items: [] })).toMatch(/^Empty now/);
    expect(shownLabel({ queue: 'telemetryBuffer', total: 1, items: items(1) })).toBe(
      'The only one',
    );
    expect(shownLabel({ queue: 'telemetryBuffer', total: 3, items: items(3) })).toBe('All 3');
    expect(shownLabel({ queue: 'telemetryBuffer', total: 153, items: items(20) })).toBe(
      'The newest 20 of 153',
    );
    expect(shownLabel({ queue: 'notificationsDelayed', total: 31, items: items(20) })).toBe(
      'The 20 due soonest of 31',
    );
  });

  it('gives times on the viewer’s clock, to the second', () => {
    expect(formatWhen('2026-11-23T11:59:03.000Z')).toMatch(
      /^\d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}:03$/,
    );
  });

  it('shows the start of a long message first', () => {
    expect(clipText('Hello!', 10)).toEqual({ text: 'Hello!', clipped: false });
    expect(clipText('Hello there, Ada', 11)).toEqual({ text: 'Hello there…', clipped: true });
  });
});
