import { describe, expect, it } from 'vitest';
import {
  bufferedEventSchema,
  eventRequestSchema,
} from '../../../src/schema/analytics-event.schema.js';

const PAGE_VIEW = { type: 'page_view', path: '/projects/x', sessionId: 'k3J9xQ2mP0aZ' };

/** The `path.message` of every issue, so tests read like the 400 response's `details`. */
function problems(input: unknown): string[] {
  const result = eventRequestSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('eventRequestSchema', () => {
  it('accepts a minimal page view and an interaction with a name', () => {
    expect(problems(PAGE_VIEW)).toEqual([]);
    expect(problems({ ...PAGE_VIEW, type: 'interaction', name: 'click:github-link' })).toEqual([]);
  });

  it('requires a name for interactions and forbids one for page views', () => {
    expect(problems({ ...PAGE_VIEW, type: 'interaction' })).toEqual([
      'name: is required for interactions',
    ]);
    expect(problems({ ...PAGE_VIEW, name: 'click:x' })).toEqual([
      'name: must be null for page views',
    ]);
  });

  it('treats an empty referrer as "no referrer" but rejects non-http(s) URLs', () => {
    expect(eventRequestSchema.parse({ ...PAGE_VIEW, referrer: '' }).referrer).toBeNull();
    expect(problems({ ...PAGE_VIEW, referrer: 'javascript:alert(1)' })).toHaveLength(1);
  });

  it('accepts IANA time zones and rejects anything else', () => {
    for (const timezone of [
      'UTC',
      'Asia/Singapore',
      'America/Argentina/Buenos_Aires',
      'Etc/GMT+8',
    ]) {
      expect(problems({ ...PAGE_VIEW, timezone })).toEqual([]);
    }
    expect(problems({ ...PAGE_VIEW, timezone: 'Asia/Singapore; DROP TABLE' })).toEqual([
      'timezone: must be an IANA time zone such as "Asia/Singapore"',
    ]);
  });

  it('rejects malformed fields, listing every problem', () => {
    expect(
      problems({ type: 'purchase', path: 'no-slash', sessionId: 'short', name: 'Bad Name' }),
    ).toEqual([
      expect.stringMatching(/^type:/),
      'path: must start with "/"',
      expect.stringMatching(/^sessionId: must be 8-64/),
      expect.stringMatching(/^name: must be 1-64/),
    ]);
  });
});

describe('bufferedEventSchema', () => {
  it('still reads events buffered before visitor details existed (all details unknown)', () => {
    // Exactly what the previous API version wrote to Redis.
    const oldEvent = {
      id: 'c0dc5e66-638f-42e7-885f-0b392f07b8a6',
      type: 'page_view',
      name: null,
      path: '/projects/bowling-buddy',
      referrerHost: 'www.linkedin.com',
      sessionId: 'demoSession01',
      visitorHash: 'aaf7e3397d6e99b945f1535eba80075183d612242b0da38ecf67a4fc1b01805a',
      receivedAt: '2026-11-17T15:01:47.895Z',
    };

    const event = bufferedEventSchema.parse(oldEvent);

    expect(event.campaign).toEqual({
      ref: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });
    expect(event.device.browser).toBeNull();
    expect(event.network.organization).toBeNull();
  });
});
