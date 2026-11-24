import type { DailyCount, VisitorInsightsDal } from '../dal/visitor-insights.dal.js';
import type { Logger } from '../infra/logger.js';
import type { Visit, VisitorSummary } from '../schema/visitor-insights.schema.js';

const DAY_MS = 86_400_000;
/** Entries per ranked list. */
const TOP = 10;
const RECENT_VISITS = 50;
/** Plenty for a portfolio, and a memory cap if a bot floods it. */
export const MAX_VISITS_PER_SUMMARY = 20_000;

/** The visitor summary (DESIGN.md §7.8). Postgres groups events into visits; this ranks them. */
export interface VisitorInsightsManager {
  /** The last `days` UTC days, today included. */
  getSummary: (days: number, log: Logger) => Promise<VisitorSummary>;
}

export interface VisitorInsightsManagerDependencies {
  insightsDal: VisitorInsightsDal;
  now?: () => Date;
  maxVisits?: number;
}

export function createVisitorInsightsManager(
  dependencies: VisitorInsightsManagerDependencies,
): VisitorInsightsManager {
  const { insightsDal } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const maxVisits = dependencies.maxVisits ?? MAX_VISITS_PER_SUMMARY;

  return {
    async getSummary(days, log) {
      const generatedAt = now();
      const since = new Date(startOfUtcDay(generatedAt).getTime() - (days - 1) * DAY_MS);

      const [visits, daily, pages, missingPages, clicks] = await Promise.all([
        insightsDal.listVisits(since, maxVisits),
        insightsDal.dailyCounts(since),
        insightsDal.topPages(since, TOP, true),
        insightsDal.topPages(since, TOP, false),
        insightsDal.topClicks(since, TOP),
      ]);
      const truncated = visits.length >= maxVisits;
      if (truncated) {
        log.warn({ days, maxVisits }, 'visitor summary truncated to the newest visits');
      }

      return {
        days,
        since: since.toISOString(),
        generatedAt: generatedAt.toISOString(),
        truncated,
        totals: {
          pageViews: sum(visits, (visit) => visit.pageViews),
          visits: visits.length,
          clicks: sum(visits, (visit) => visit.clicks),
        },
        daily: everyDay(since, generatedAt, daily),
        referrers: rank(visits, (visit) => ({ referrer: visit.referrer })),
        campaigns: rank(visits.filter(hasCampaign), (visit) => ({
          ref: visit.ref,
          utmSource: visit.utmSource,
          utmMedium: visit.utmMedium,
          utmCampaign: visit.utmCampaign,
        })),
        locations: rank(visits, (visit) => ({ countryCode: visit.countryCode, city: visit.city })),
        organizations: rankOrganizations(visits),
        pages,
        missingPages,
        devices: rank(visits, (visit) => ({ deviceType: visit.deviceType })),
        browsers: rank(visits, (visit) => ({ browser: visit.browser })),
        clicks,
        recentVisits: visits.slice(0, RECENT_VISITS),
      };
    },
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** One entry per day, so days without visits show as zero. */
function everyDay(since: Date, today: Date, counts: readonly DailyCount[]): DailyCount[] {
  const byDay = new Map(counts.map((count) => [count.day, count]));
  const days: DailyCount[] = [];
  for (let at = since.getTime(); at <= today.getTime(); at += DAY_MS) {
    const day = new Date(at).toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, pageViews: 0, visitors: 0 });
  }
  return days;
}

function hasCampaign(visit: Visit): boolean {
  return [visit.ref, visit.utmSource, visit.utmMedium, visit.utmCampaign].some((v) => v !== null);
}

/** Visits per `pick` group, largest first (ties stable), at most TOP; `null` is a group too. */
function rank<K extends Record<string, string | null>>(
  visits: readonly Visit[],
  pick: (visit: Visit) => K,
): (K & { visits: number })[] {
  const groups = new Map<string, K & { visits: number }>();
  for (const visit of visits) {
    const key = pick(visit);
    const id = JSON.stringify(key);
    const group = groups.get(id);
    if (group) {
      group.visits += 1;
    } else {
      groups.set(id, { ...key, visits: 1 });
    }
  }
  return [...groups.entries()]
    .sort(([idA, a], [idB, b]) => b.visits - a.visits || idA.localeCompare(idB))
    .slice(0, TOP)
    .map(([, group]) => group);
}

/** Like `rank`, for named networks only, with when each was last seen. */
function rankOrganizations(visits: readonly Visit[]): VisitorSummary['organizations'] {
  const named = visits.filter(
    (visit): visit is Visit & { organization: string } => visit.organization !== null,
  );
  const lastSeen = new Map<string, string>();
  for (const visit of named) {
    const id = JSON.stringify([visit.organization, visit.countryCode]);
    const previous = lastSeen.get(id);
    if (previous === undefined || visit.lastSeenAt > previous) {
      lastSeen.set(id, visit.lastSeenAt);
    }
  }
  return rank(named, (visit) => ({
    organization: visit.organization,
    countryCode: visit.countryCode,
  })).map((group) => ({
    organization: group.organization ?? '',
    countryCode: group.countryCode,
    visits: group.visits,
    lastSeenAt: lastSeen.get(JSON.stringify([group.organization, group.countryCode])) ?? '',
  }));
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}
