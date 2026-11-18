import { describe, expect, it } from 'vitest';
import type { IpLocationDal } from '../../../src/dal/ip-location.dal.js';
import {
  campaignFrom,
  createVisitorDetailsManager,
  deviceFrom,
  primaryLanguage,
} from '../../../src/services/visitor-details.manager.js';

const USER_AGENTS = {
  chromeOnMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  safariOnIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  edgeOnWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};

describe('campaignFrom', () => {
  it('keeps ref and utm_* parameters from the query string', () => {
    expect(
      campaignFrom('/?ref=acme&utm_source=linkedin&utm_medium=social&utm_campaign=jobs-2026'),
    ).toEqual({
      ref: 'acme',
      utmSource: 'linkedin',
      utmMedium: 'social',
      utmCampaign: 'jobs-2026',
    });
  });

  it('decodes values and treats missing or empty parameters as unknown', () => {
    expect(campaignFrom('/projects/x?ref=Acme%20Corp&utm_source=')).toEqual({
      ref: 'Acme Corp',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });
    expect(campaignFrom('/projects/x').ref).toBeNull();
  });

  it('ignores parameters inside the fragment', () => {
    expect(campaignFrom('/a#top?ref=acme').ref).toBeNull();
    expect(campaignFrom('/a?ref=acme#top').ref).toBe('acme');
  });
});

describe('deviceFrom', () => {
  const NO_LANGUAGE = { acceptLanguage: '' };

  it('names the browser, operating system and device type', () => {
    expect(deviceFrom({ userAgent: USER_AGENTS.chromeOnMac, ...NO_LANGUAGE }, null)).toMatchObject({
      browser: 'Chrome',
      os: 'macOS',
      type: 'desktop',
    });
    expect(
      deviceFrom({ userAgent: USER_AGENTS.safariOnIphone, ...NO_LANGUAGE }, null),
    ).toMatchObject({ browser: 'Safari', os: 'iOS', type: 'mobile' });
    expect(
      deviceFrom({ userAgent: USER_AGENTS.edgeOnWindows, ...NO_LANGUAGE }, null),
    ).toMatchObject({ browser: 'Microsoft Edge', os: 'Windows', type: 'desktop' });
  });

  it('recognises crawlers as bots, so they can be filtered out', () => {
    expect(deviceFrom({ userAgent: USER_AGENTS.googlebot, ...NO_LANGUAGE }, null)).toMatchObject({
      browser: 'Googlebot',
      type: 'bot',
    });
  });

  it('copes with a missing or meaningless user agent', () => {
    const unknown = { browser: null, os: null, type: null };
    // bowser itself throws on an empty string; deviceFrom must not.
    expect(deviceFrom({ userAgent: '', ...NO_LANGUAGE }, null)).toMatchObject(unknown);
    expect(deviceFrom({ userAgent: 'curl/8.5.0', ...NO_LANGUAGE }, null)).toMatchObject(unknown);
  });

  it('adds the preferred language and the time zone the browser reported', () => {
    expect(
      deviceFrom({ userAgent: USER_AGENTS.chromeOnMac, acceptLanguage: 'en-SG,en;q=0.9' }, 'UTC'),
    ).toMatchObject({ language: 'en-SG', timezone: 'UTC' });
  });
});

describe('primaryLanguage', () => {
  it('takes the first (preferred) language tag', () => {
    expect(primaryLanguage('en-SG,en;q=0.9,zh;q=0.8')).toBe('en-SG');
    expect(primaryLanguage('zh-Hant-TW')).toBe('zh-Hant-TW');
    expect(primaryLanguage('fr;q=0.7')).toBe('fr');
  });

  it('returns null for wildcards, junk and missing headers', () => {
    expect(primaryLanguage('*')).toBeNull();
    expect(primaryLanguage('<script>')).toBeNull();
    expect(primaryLanguage('')).toBeNull();
  });
});

describe('VisitorDetailsManager.describe', () => {
  it('combines the link, the browser and the IP lookup', () => {
    const lookedUp: string[] = [];
    const ipLocationDal: IpLocationDal = {
      lookup: (ip) => {
        lookedUp.push(ip);
        return { countryCode: 'SG', city: 'Singapore', organization: 'Example Corp' };
      },
    };
    const manager = createVisitorDetailsManager({ ipLocationDal });

    const details = manager.describe(
      { type: 'page_view', path: '/?ref=acme', sessionId: 'k3J9xQ2mP0aZ', timezone: null },
      { ip: '203.0.113.7', userAgent: USER_AGENTS.chromeOnMac, acceptLanguage: 'en' },
    );

    expect(lookedUp).toEqual(['203.0.113.7']);
    expect(details).toEqual({
      campaign: { ref: 'acme', utmSource: null, utmMedium: null, utmCampaign: null },
      device: { browser: 'Chrome', os: 'macOS', type: 'desktop', language: 'en', timezone: null },
      network: { countryCode: 'SG', city: 'Singapore', organization: 'Example Corp' },
    });
  });
});
