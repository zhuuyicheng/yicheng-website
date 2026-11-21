import { describe, expect, it } from 'vitest';
import {
  formatDay,
  formatDuration,
  formatMonth,
  formatRange,
  monthsBetween,
  paragraphs,
} from '@/lib/format';

describe('date formatting', () => {
  it('reads YYYY-MM-DD as UTC, so the 1st never shows as the previous month', () => {
    expect(formatMonth('2026-07-01')).toBe('Jul 2026');
  });

  it('formats a range, with "present" for a current role', () => {
    expect(formatRange('2026-07-01', '2026-10-31')).toBe('Jul 2026 — Oct 2026');
    expect(formatRange('2026-07-01', null)).toBe('Jul 2026 — present');
  });

  it('counts the months of a range, including both ends', () => {
    expect(monthsBetween('2026-07-01', '2026-10-31')).toBe(4);
    expect(monthsBetween('2025-01-15', null, new Date('2026-02-01T00:00:00Z'))).toBe(14);
  });

  it('writes a duration in years and months', () => {
    expect(formatDuration(4)).toBe('4 mos');
    expect(formatDuration(1)).toBe('1 mo');
    expect(formatDuration(14)).toBe('1 yr 2 mos');
    expect(formatDuration(24)).toBe('2 yrs');
  });

  it('shows a "Last updated" moment as the day in Singapore', () => {
    expect(formatDay('2026-11-21T09:30:00.000Z')).toBe('21 November 2026');
    // 23:00 UTC on the 20th is already 07:00 on the 21st in Singapore (UTC+8).
    expect(formatDay('2026-11-20T23:00:00.000Z')).toBe('21 November 2026');
  });
});

describe('paragraphs', () => {
  it('splits on blank lines, including ones with stray spaces, and drops empty parts', () => {
    expect(paragraphs('First.\n\nSecond\nline.\n  \nThird.\n\n\n')).toEqual([
      'First.',
      'Second\nline.',
      'Third.',
    ]);
  });

  it('returns nothing for blank text', () => {
    expect(paragraphs('  \n\n ')).toEqual([]);
  });
});
