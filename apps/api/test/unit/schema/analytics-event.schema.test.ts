import { describe, expect, it } from 'vitest';
import { eventRequestSchema } from '../../../src/schema/analytics-event.schema.js';

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
