import type { Visit } from '@portfolio/shared';

/**
 * Labels and numbers for the owner's visitor summary (app/admin). No React, so it can be
 * unit-tested.
 */

export const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

export const DEFAULT_DAYS = 7;

/** `?days=` from the URL: one of PERIODS, or the default for anything else. */
export function parseDays(value: string | string[] | undefined): number {
  const days = Number(Array.isArray(value) ? value[0] : value);
  return PERIODS.some((period) => period.days === days) ? days : DEFAULT_DAYS;
}

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region' });

/** `SG` → `Singapore`; an unrecognised code is shown as it is. */
export function countryName(code: string): string {
  try {
    return REGIONS.of(code) ?? code;
  } catch {
    return code;
  }
}

/** `Singapore` (a city-state), `Mountain View, United States`, `United States`, or unknown. */
export function placeLabel(countryCode: string | null, city: string | null): string {
  const country = countryCode === null ? null : countryName(countryCode);
  if (city !== null && country !== null) {
    return city === country ? city : `${city}, ${country}`;
  }
  return city ?? country ?? 'Unknown place';
}

/** `www.linkedin.com` → `linkedin.com`; no referrer → typed in, a bookmark, or an app. */
export function referrerLabel(referrer: string | null): string {
  return referrer === null ? 'Direct or unknown' : referrer.replace(/^www\./, '');
}

/** A tagged link: `ref acme`, `linkedin / social / launch` (source / medium / campaign). */
export function campaignLabel(campaign: {
  ref: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}): string {
  const utm = [campaign.utmSource, campaign.utmMedium, campaign.utmCampaign]
    .filter((part): part is string => part !== null)
    .join(' / ');
  const parts = [campaign.ref === null ? null : `ref ${campaign.ref}`, utm || null];
  return parts.filter((part): part is string => part !== null).join(' · ');
}

/** `Desktop · Chrome · macOS`, leaving out what is unknown. */
export function deviceLabel(visit: Pick<Visit, 'deviceType' | 'browser' | 'os'>): string {
  const type = visit.deviceType === null ? null : capitalise(visit.deviceType);
  const parts = [type, visit.browser, visit.os].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Unknown device' : parts.join(' · ');
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `just now`, `12 min ago`, `3 h ago`, `2 d ago`, measured against `now` (ms). */
export function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return `${String(Math.floor(hours / 24))} d ago`;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** `2026-11-18` → `18 Nov` (the days are UTC days). */
export function formatDay(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00Z`));
}

/** The pages of a visit, shortened: `/ → /bowling-buddy → /portfolio-telemetry-platform +2`. */
export function pagesLabel(paths: readonly string[], shown = 3): string {
  const head = paths.slice(0, shown).join(' → ');
  const rest = paths.length - shown;
  return rest > 0 ? `${head} +${String(rest)}` : head;
}

/** A bar's length as a share of the longest (0 when everything is 0). */
export function share(value: number, max: number): number {
  return max <= 0 ? 0 : Math.min(1, value / max);
}
