import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { VisitorInsightsDal } from '../../../src/dal/visitor-insights.dal.js';
import type { Visit } from '../../../src/schema/visitor-insights.schema.js';
import { createVisitorInsightsManager } from '../../../src/services/visitor-insights.manager.js';

const log = pino({ level: 'silent' });
const NOW = new Date('2026-11-18T09:30:00Z');

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    startedAt: '2026-11-18T09:00:00.000Z',
    lastSeenAt: '2026-11-18T09:05:00.000Z',
    pageViews: 1,
    clicks: 0,
    paths: ['/'],
    referrer: null,
    ref: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    organization: null,
    city: null,
    countryCode: null,
    deviceType: 'desktop',
    browser: 'Chrome',
    os: 'macOS',
    ...overrides,
  };
}

function fakeDal(visits: Visit[], calls: { since?: Date } = {}): VisitorInsightsDal {
  return {
    listVisits: (since, limit) => {
      calls.since = since;
      return Promise.resolve(visits.slice(0, limit));
    },
    dailyCounts: () => Promise.resolve([{ day: '2026-11-17', pageViews: 4, visitors: 2 }]),
    topPages: () => Promise.resolve([]),
    topClicks: () => Promise.resolve([]),
  };
}

describe('visitor insights manager', () => {
  it('counts whole UTC days back from today, with zero for days without visits', async () => {
    const calls: { since?: Date } = {};
    const manager = createVisitorInsightsManager({
      insightsDal: fakeDal([], calls),
      now: () => NOW,
    });

    const summary = await manager.getSummary(3, log);

    expect(calls.since?.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(summary.daily).toEqual([
      { day: '2026-11-16', pageViews: 0, visitors: 0 },
      { day: '2026-11-17', pageViews: 4, visitors: 2 },
      { day: '2026-11-18', pageViews: 0, visitors: 0 },
    ]);
  });

  it('ranks referrers, places and devices by visits, with "direct" (null) as a group', async () => {
    const manager = createVisitorInsightsManager({
      insightsDal: fakeDal([
        visit({ referrer: 'www.linkedin.com', countryCode: 'SG', city: 'Singapore' }),
        visit({ referrer: 'www.linkedin.com', countryCode: 'SG', city: 'Singapore' }),
        visit({ referrer: null, countryCode: 'US', city: null, deviceType: 'mobile' }),
      ]),
      now: () => NOW,
    });

    const summary = await manager.getSummary(7, log);

    expect(summary.referrers).toEqual([
      { referrer: 'www.linkedin.com', visits: 2 },
      { referrer: null, visits: 1 },
    ]);
    expect(summary.locations[0]).toEqual({ countryCode: 'SG', city: 'Singapore', visits: 2 });
    expect(summary.devices).toEqual([
      { deviceType: 'desktop', visits: 2 },
      { deviceType: 'mobile', visits: 1 },
    ]);
    expect(summary.totals).toEqual({ pageViews: 3, visits: 3, clicks: 0 });
  });

  it('lists only tagged visits as campaigns, and named networks with when they were last seen', async () => {
    const manager = createVisitorInsightsManager({
      insightsDal: fakeDal([
        visit({ ref: 'acme', organization: 'Acme', lastSeenAt: '2026-11-18T09:05:00.000Z' }),
        visit({ organization: 'Acme', lastSeenAt: '2026-11-18T09:20:00.000Z' }),
        visit(),
      ]),
      now: () => NOW,
    });

    const summary = await manager.getSummary(7, log);

    expect(summary.campaigns).toEqual([
      { ref: 'acme', utmSource: null, utmMedium: null, utmCampaign: null, visits: 1 },
    ]);
    expect(summary.organizations).toEqual([
      {
        organization: 'Acme',
        countryCode: null,
        visits: 2,
        lastSeenAt: '2026-11-18T09:20:00.000Z',
      },
    ]);
  });

  it('flags a summary that hit the visit cap, keeps at most 50 recent visits, and logs it', async () => {
    const visits = Array.from({ length: 60 }, () => visit());
    const manager = createVisitorInsightsManager({
      insightsDal: fakeDal(visits),
      now: () => NOW,
      maxVisits: 60,
    });
    const warn = vi.spyOn(log, 'warn');

    const summary = await manager.getSummary(7, log);

    expect(summary.truncated).toBe(true);
    expect(summary.recentVisits).toHaveLength(50);
    expect(warn).toHaveBeenCalledOnce();
  });
});
