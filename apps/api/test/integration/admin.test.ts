import { visitorSummarySchema, type VisitorSummary } from '@portfolio/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createAnalyticsEventDal } from '../../src/dal/analytics-event.dal.js';
import {
  bufferedEventSchema,
  type BufferedEvent,
} from '../../src/schema/analytics-event.schema.js';
import type { ErrorResponseBody } from '../../src/views/error.view.js';
import { bufferedEventJson } from '../helpers/telemetry-events.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';

/** The owner's token, from test-env.ts (ADMIN_TOKEN). */
const OWNER = { authorization: 'Bearer integration-test-admin-token-0123456789abcdef' };
const VISITORS_URL = '/api/v1/admin/visitors';
const STATUS_URL = '/api/v1/admin/system-status';

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
    for (const url of [VISITORS_URL, STATUS_URL]) {
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
});
