/** API dates are `YYYY-MM-DD`, read as UTC: a local time zone could turn 07-01 into 06-30. */
const MONTH_YEAR = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-07-01` → `Jul 2026`. */
export function formatMonth(isoDate: string): string {
  return MONTH_YEAR.format(new Date(`${isoDate}T00:00:00Z`));
}

/** `Jul 2026 — Oct 2026`, or `… — present` when `end` is null. */
export function formatRange(start: string, end: string | null): string {
  return `${formatMonth(start)} — ${end === null ? 'present' : formatMonth(end)}`;
}

/** Whole months, both ends counted: Jul → Oct is 4. `now` is for "present". */
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

/** "Last updated" moments are shown as the day in Singapore, where the owner edits. */
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Singapore',
});

/** `2026-11-20T23:00:00.000Z` → `21 November 2026` (Singapore). */
export function formatDay(isoTimestamp: string): string {
  return DAY_MONTH_YEAR.format(new Date(isoTimestamp));
}

/** Blank-line-separated text → one string per paragraph. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
