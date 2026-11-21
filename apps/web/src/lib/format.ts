/**
 * Dates from the API are `YYYY-MM-DD` strings (DESIGN.md §7.4). They are read as UTC: parsing
 * them in the server's or visitor's time zone could shift "2026-07-01" to June 30.
 */
const MONTH_YEAR = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-07-01` → `Jul 2026`. */
export function formatMonth(isoDate: string): string {
  return MONTH_YEAR.format(new Date(`${isoDate}T00:00:00Z`));
}

/** `Jul 2026 — Oct 2026`, or `Jul 2026 — present` for a current role (`end` is null). */
export function formatRange(start: string, end: string | null): string {
  return `${formatMonth(start)} — ${end === null ? 'present' : formatMonth(end)}`;
}

/** Whole months covered, counting both ends: Jul → Oct is 4 months. `now` is for "present". */
export function monthsBetween(start: string, end: string | null, now = new Date()): number {
  const from = new Date(`${start}T00:00:00Z`);
  const to = end === null ? now : new Date(`${end}T00:00:00Z`);
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return Math.max(1, months + 1);
}

/** `4` → `4 mos`, `14` → `1 yr 2 mos`. */
export function formatDuration(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${String(years)} yr${years === 1 ? '' : 's'}`);
  if (rest > 0) parts.push(`${String(rest)} mo${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/**
 * "Last updated" values are moments (ISO timestamps), not dates. They are shown as the day in
 * Singapore, where the owner edits: a change at 07:00 there on 21 November reads "21 November
 * 2026", although it is still the 20th in UTC.
 */
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Singapore',
});

/** `2026-11-20T23:00:00.000Z` → `21 November 2026` (the day in Singapore). */
export function formatDay(isoTimestamp: string): string {
  return DAY_MONTH_YEAR.format(new Date(isoTimestamp));
}

/** Text with paragraphs separated by blank lines → one string per paragraph, blanks dropped. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
