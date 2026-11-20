import { describe, expect, it } from 'vitest';
import {
  campaignLabel,
  deviceLabel,
  formatDay,
  pagesLabel,
  parseDays,
  placeLabel,
  referrerLabel,
  share,
  timeAgo,
} from '@/lib/visitors';

describe('visitor summary labels', () => {
  it('accepts only the offered periods, defaulting to 7 days', () => {
    expect(parseDays('30')).toBe(30);
    expect(parseDays(['90', '1'])).toBe(90);
    expect(parseDays('12')).toBe(7);
    expect(parseDays(undefined)).toBe(7);
  });

  it('names places without repeating a city-state', () => {
    expect(placeLabel('SG', 'Singapore')).toBe('Singapore');
    expect(placeLabel('US', 'Mountain View')).toBe('Mountain View, United States');
    expect(placeLabel('US', null)).toBe('United States');
    expect(placeLabel(null, null)).toBe('Unknown place');
  });

  it('shortens referrers and calls a missing one direct', () => {
    expect(referrerLabel('www.linkedin.com')).toBe('linkedin.com');
    expect(referrerLabel(null)).toBe('Direct or unknown');
  });

  it('describes tagged links by ref and UTM fields', () => {
    const none = { ref: null, utmSource: null, utmMedium: null, utmCampaign: null };
    expect(campaignLabel({ ...none, ref: 'acme' })).toBe('ref acme');
    expect(campaignLabel({ ...none, utmSource: 'linkedin', utmCampaign: 'launch' })).toBe(
      'linkedin / launch',
    );
    expect(campaignLabel({ ...none, ref: 'acme', utmSource: 'email' })).toBe('ref acme · email');
  });

  it('describes devices, leaving out unknown parts', () => {
    expect(deviceLabel({ deviceType: 'desktop', browser: 'Chrome', os: 'macOS' })).toBe(
      'Desktop · Chrome · macOS',
    );
    expect(deviceLabel({ deviceType: null, browser: null, os: null })).toBe('Unknown device');
  });

  it('says how long ago something happened', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    expect(timeAgo('2026-11-18T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-18T11:48:00Z', now)).toBe('12 min ago');
    expect(timeAgo('2026-11-18T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-11-16T11:00:00Z', now)).toBe('2 d ago');
  });

  it('formats UTC days, page lists and bar shares', () => {
    expect(formatDay('2026-11-18')).toBe('18 Nov');
    expect(pagesLabel(['/', '/projects/a', '/privacy', '/projects/b', '/'])).toBe(
      '/ → /projects/a → /privacy +2',
    );
    expect(share(5, 10)).toBe(0.5);
    expect(share(3, 0)).toBe(0);
  });
});
