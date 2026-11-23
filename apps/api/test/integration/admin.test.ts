import {
  queueItemsSchema,
  visitorSummarySchema,
  type QueueItems,
  type VisitorSummary,
} from '@portfolio/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createAnalyticsEventDal } from '../../src/dal/analytics-event.dal.js';
import { createContactMessageDal } from '../../src/dal/contact-message.dal.js';
import { createEventBufferDal, TELEMETRY_BUFFER_KEYS } from '../../src/dal/event-buffer.dal.js';
import {
  createNotificationQueueDal,
  NOTIFICATION_QUEUE_KEYS,
} from '../../src/dal/notification-queue.dal.js';
import {
  bufferedEventSchema,
  type BufferedEvent,
} from '../../src/schema/analytics-event.schema.js';
import type { ErrorResponseBody } from '../../src/views/error.view.js';
import { notificationJobJson } from '../helpers/contact-messages.js';
import { bufferedEventJson } from '../helpers/telemetry-events.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';

/** The owner's token, from test-env.ts (ADMIN_TOKEN). */
const OWNER = { authorization: 'Bearer integration-test-admin-token-0123456789abcdef' };
const VISITORS_URL = '/api/v1/admin/visitors';
const STATUS_URL = '/api/v1/admin/system-status';
const QUEUES_URL = '/api/v1/admin/queues';

function event(overrides: Partial<BufferedEvent>): BufferedEvent {
  return bufferedEventSchema.parse(JSON.parse(bufferedEventJson(overrides)));
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe('owner endpoints (/api/v1/admin/*) with live Postgres and Redis', () => {
  let deps: TestDependencies;
  let app: FastifyInstance;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  beforeEach(async () => {
    await deps.postgres.query('TRUNCATE analytics_events');
    app = buildApp(deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function getSummary(days: number): Promise<VisitorSummary> {
    const response = await app.inject({
      method: 'GET',
      url: `${VISITORS_URL}?days=${String(days)}`,
      headers: OWNER,
    });
    expect(response.statusCode).toBe(200);
    // Parsing with the shared schema checks the response against the contract the web app uses.
    return visitorSummarySchema.parse(response.json<{ data: unknown }>().data);
  }

  it('answer 401 without the owner token, and are never cached', async () => {
    for (const url of [VISITORS_URL, STATUS_URL, `${QUEUES_URL}/telemetryDeadLetter`]) {
      const missing = await app.inject({ method: 'GET', url });
      const wrong = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: 'Bearer not-the-owner-token-0123456789abcdef' },
      });
      const owner = await app.inject({ method: 'GET', url, headers: OWNER });

      expect(missing.statusCode).toBe(401);
      expect(missing.json<ErrorResponseBody>().error.code).toBe('UNAUTHORIZED');
      expect(wrong.statusCode).toBe(401);
      expect(owner.statusCode).toBe(200);
      expect(owner.headers['cache-control']).toBe('no-store');
    }
  });

  it('no longer serves the status report publicly', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/system/status' });
    expect(response.statusCode).toBe(404);
  });

  it('do not exist at all without ADMIN_TOKEN', async () => {
    const closed = buildApp({ ...deps, config: { ...deps.config, admin: { token: null } } });
    try {
      const response = await closed.inject({ method: 'GET', url: VISITORS_URL, headers: OWNER });
      expect(response.statusCode).toBe(404);
    } finally {
      await closed.close();
    }
  });

  it('summarises visits: referrer and tagged link from the first page; bots, /admin and older events left out', async () => {
    const acme = {
      sessionId: 'visit-from-acme-0001',
      visitorHash: 'a'.repeat(64),
      network: { countryCode: 'SG', city: 'Singapore', organization: 'Acme Pte Ltd' },
      device: { browser: 'Chrome', os: 'macOS', type: 'desktop', language: null, timezone: null },
      ipAddress: '203.0.113.7',
    };
    await createAnalyticsEventDal(deps.postgres).insertBatch([
      // A visit from a tagged LinkedIn link: two pages and a click.
      event({
        ...acme,
        path: '/',
        referrerHost: 'www.linkedin.com',
        campaign: { ref: 'acme', utmSource: null, utmMedium: null, utmCampaign: null },
        receivedAt: minutesAgo(30),
      }),
      event({ ...acme, path: '/projects/bowling-buddy', receivedAt: minutesAgo(29) }),
      event({ ...acme, type: 'interaction', name: 'click:linkedin', receivedAt: minutesAgo(28) }),
      // A direct visit on a phone.
      event({
        sessionId: 'direct-on-phone-0002',
        visitorHash: 'b'.repeat(64),
        network: { countryCode: 'US', city: null, organization: 'Google LLC' },
        device: { browser: 'Safari', os: 'iOS', type: 'mobile', language: null, timezone: null },
        receivedAt: minutesAgo(10),
      }),
      // Not counted: a crawler, the owner's own /admin page, and a visit 10 days ago.
      event({
        sessionId: 'crawler-visit-00003',
        device: { browser: null, os: null, type: 'bot', language: null, timezone: null },
        receivedAt: minutesAgo(5),
      }),
      event({ sessionId: 'owner-on-admin-0004', path: '/admin', receivedAt: minutesAgo(3) }),
      event({ sessionId: 'ten-days-ago-00005', receivedAt: minutesAgo(10 * 24 * 60) }),
    ]);

    const summary = await getSummary(7);

    expect(summary.totals).toEqual({ pageViews: 3, visits: 2, clicks: 1 });
    expect(summary.daily).toHaveLength(7);
    expect(summary.daily.reduce((total, day) => total + day.pageViews, 0)).toBe(3);
    expect(summary.referrers).toEqual(
      expect.arrayContaining([
        { referrer: 'www.linkedin.com', visits: 1 },
        { referrer: null, visits: 1 },
      ]),
    );
    expect(summary.campaigns).toEqual([
      { ref: 'acme', utmSource: null, utmMedium: null, utmCampaign: null, visits: 1 },
    ]);
    expect(summary.organizations.map((org) => org.organization).sort()).toEqual([
      'Acme Pte Ltd',
      'Google LLC',
    ]);
    expect(summary.pages).toEqual([
      { path: '/', views: 2, visits: 2 },
      { path: '/projects/bowling-buddy', views: 1, visits: 1 },
    ]);
    expect(summary.clicks).toEqual([{ name: 'click:linkedin', clicks: 1 }]);

    // Newest first: the phone visit, then the tagged one with everything known about it.
    expect(summary.recentVisits.map((visit) => visit.deviceType)).toEqual(['mobile', 'desktop']);
    expect(summary.recentVisits[1]).toMatchObject({
      pageViews: 2,
      clicks: 1,
      paths: ['/', '/projects/bowling-buddy'],
      referrer: 'www.linkedin.com',
      ref: 'acme',
      organization: 'Acme Pte Ltd',
      city: 'Singapore',
      countryCode: 'SG',
      browser: 'Chrome',
      ipAddress: '203.0.113.7',
    });
    expect(summary.recentVisits[0]?.ipAddress).toBeNull(); // an event without an address
  });

  it('rejects a period outside 1-365 days', async () => {
    for (const days of ['0', '366', 'week']) {
      const response = await app.inject({
        method: 'GET',
        url: `${VISITORS_URL}?days=${days}`,
        headers: OWNER,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorResponseBody>().error.code).toBe('VALIDATION_ERROR');
    }
  });

  describe('GET /api/v1/admin/queues/:queue', () => {
    beforeEach(async () => {
      await deps.redis.flushdb(); // Redis DB 1 (tests) only
      await deps.postgres.query('TRUNCATE contact_messages');
    });

    async function getItems(queue: string, query = ''): Promise<QueueItems> {
      const response = await app.inject({
        method: 'GET',
        url: `${QUEUES_URL}/${queue}${query}`,
        headers: OWNER,
      });
      expect(response.statusCode).toBe(200);
      // The shared schema: the contract the web app's queue card parses.
      return queueItemsSchema.parse(response.json<{ data: unknown }>().data);
    }

    const paths = (result: QueueItems) =>
      result.items.map((item) => (item.kind === 'event' ? item.event?.path : undefined));
    const senders = (result: QueueItems) =>
      result.items.map((item) => (item.kind === 'notification' ? item.message?.name : undefined));

    it('lists waiting and dead-lettered visits newest first, and takes nothing out', async () => {
      // Written the way the API and the worker write them.
      const bufferDal = createEventBufferDal(deps.redis);
      for (const path of ['/first', '/second', '/third']) {
        expect(await bufferDal.enqueue(bufferedEventJson({ path }), 100)).toBe(true);
      }
      const refused = (path: string) =>
        JSON.stringify({
          payload: bufferedEventJson({ path }),
          reason: 'insert_failed',
          errorCode: '23514',
          errorMessage: 'new row violates a check constraint',
          failedAt: new Date().toISOString(),
        });
      await bufferDal.acknowledge([refused('/older'), refused('/newer')]);

      const buffer = await getItems('telemetryBuffer', '?limit=2');
      expect(buffer.total).toBe(3);
      expect(paths(buffer)).toEqual(['/third', '/second']);
      expect(await deps.redis.llen(TELEMETRY_BUFFER_KEYS.buffer)).toBe(3);

      const deadLetters = await getItems('telemetryDeadLetter');
      expect(paths(deadLetters)).toEqual(['/newer', '/older']);
      expect(deadLetters.items[0]).toMatchObject({
        deadLetter: { reason: 'insert_failed', errorCode: '23514' },
      });
      expect(await deps.redis.llen(TELEMETRY_BUFFER_KEYS.deadLetter)).toBe(2);
    });

    it('names the sender of each notification: ready newest first, retries by due time', async () => {
      const contactDal = createContactMessageDal(deps.postgres);
      const ada = await contactDal.insert({
        name: 'Ada',
        email: 'ada@example.com',
        message: 'Hello!',
        ipHash: 'a'.repeat(64),
      });
      const bob = await contactDal.insert({
        name: 'Bob',
        email: 'bob@example.com',
        message: 'Hi there',
        ipHash: 'b'.repeat(64),
      });
      const queueDal = createNotificationQueueDal(deps.redis);
      await queueDal.enqueue(notificationJobJson({ messageId: ada.id }));
      await queueDal.enqueue(notificationJobJson({ messageId: bob.id })); // the newest
      const soon = Date.parse('2026-11-23T12:00:10.000Z');
      const later = Date.parse('2026-11-23T12:01:00.000Z');
      await deps.redis.zadd(
        NOTIFICATION_QUEUE_KEYS.delayed,
        later,
        notificationJobJson({ messageId: ada.id, attempt: 3 }),
        soon,
        notificationJobJson({ messageId: bob.id, attempt: 2 }),
      );
      const gaveUp = (messageId: string) =>
        JSON.stringify({
          payload: notificationJobJson({ messageId }),
          reason: 'rejected',
          error: 'Discord webhook answered 404',
          failedAt: new Date().toISOString(),
        });
      await deps.redis.rpush(NOTIFICATION_QUEUE_KEYS.deadLetter, gaveUp(ada.id), gaveUp(bob.id));

      const ready = await getItems('notificationsReady');
      expect(senders(ready)).toEqual(['Bob', 'Ada']);
      expect(ready.items[0]).toMatchObject({
        attempt: 1,
        message: { email: 'bob@example.com', message: 'Hi there', status: 'PENDING' },
      });
      expect(await deps.redis.llen(NOTIFICATION_QUEUE_KEYS.ready)).toBe(2);

      const delayed = await getItems('notificationsDelayed');
      expect(senders(delayed)).toEqual(['Bob', 'Ada']);
      expect(delayed.items[0]).toMatchObject({ attempt: 2, dueAt: new Date(soon).toISOString() });

      const deadLetters = await getItems('notificationsDeadLetter', '?limit=1');
      expect(deadLetters.total).toBe(2);
      expect(senders(deadLetters)).toEqual(['Bob']);
      expect(deadLetters.items[0]).toMatchObject({
        deadLetter: { reason: 'rejected', error: 'Discord webhook answered 404' },
      });
    });

    it('rejects an unknown queue and a limit outside 1-100', async () => {
      for (const url of [
        `${QUEUES_URL}/telemetryInflight`,
        `${QUEUES_URL}/telemetryBuffer?limit=0`,
        `${QUEUES_URL}/telemetryBuffer?limit=101`,
      ]) {
        const response = await app.inject({ method: 'GET', url, headers: OWNER });
        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorResponseBody>().error.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
