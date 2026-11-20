import type { PostgresPool } from '../infra/postgres.js';
import type { Visit } from '../schema/visitor-insights.schema.js';

/**
 * Read-only summaries of `analytics_events` (Postgres) for the owner's /admin page
 * (DESIGN.md §7.8). The ingestion path never uses this file.
 *
 * Every query skips crawlers (`device_type = 'bot'`) and the owner's own /admin pages.
 */
export interface VisitorInsightsDal {
  /** One entry per visit (browser-tab session) that started since `since`, newest first. */
  listVisits: (since: Date, limit: number) => Promise<Visit[]>;
  /** Page views and unique visitors per UTC day; days without events are missing. */
  dailyCounts: (since: Date) => Promise<DailyCount[]>;
  /** Most viewed pages, with the number of visits that viewed each. */
  topPages: (since: Date, limit: number) => Promise<PageCount[]>;
  /** Most clicked tracked links (`interaction` events), by name. */
  topClicks: (since: Date, limit: number) => Promise<ClickCount[]>;
}

export interface DailyCount {
  day: string;
  pageViews: number;
  visitors: number;
}
export interface PageCount {
  path: string;
  views: number;
  visits: number;
}
export interface ClickCount {
  name: string;
  clicks: number;
}

// These shapes are aggregate query results, not table rows, so they live here rather than in
// dao/. Counts are cast to int in SQL: pg returns bigint (count(*)) as a string otherwise.
interface VisitRow {
  started_at: Date;
  last_seen_at: Date;
  page_views: number;
  clicks: number;
  paths: string[] | null;
  referrer: string | null;
  ref: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  organization: string | null;
  city: string | null;
  country_code: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
}

const COUNTED = `received_at >= $1
  AND device_type IS DISTINCT FROM 'bot'
  AND path NOT LIKE '/admin%'`;

/** The first non-null value of `column` in a session, by time. */
const first = (column: string) =>
  `(array_agg(${column} ORDER BY received_at) FILTER (WHERE ${column} IS NOT NULL))[1]`;

const MAX_PATHS_PER_VISIT = 20;

export function createVisitorInsightsDal(pool: PostgresPool): VisitorInsightsDal {
  return {
    async listVisits(since, limit) {
      const result = await pool.query<VisitRow>(
        `SELECT min(received_at) AS started_at,
                max(received_at) AS last_seen_at,
                (count(*) FILTER (WHERE event_type = 'page_view'))::int   AS page_views,
                (count(*) FILTER (WHERE event_type = 'interaction'))::int AS clicks,
                (array_agg(path ORDER BY received_at)
                   FILTER (WHERE event_type = 'page_view'))[1:${String(MAX_PATHS_PER_VISIT)}] AS paths,
                ${first('referrer_host')} AS referrer,
                ${first('ref')}           AS ref,
                ${first('utm_source')}    AS utm_source,
                ${first('utm_medium')}    AS utm_medium,
                ${first('utm_campaign')}  AS utm_campaign,
                ${first('organization')}  AS organization,
                ${first('city')}          AS city,
                ${first('country_code')}  AS country_code,
                ${first('device_type')}   AS device_type,
                ${first('browser')}       AS browser,
                ${first('os')}            AS os,
                ${first('host(ip_address)')} AS ip_address
           FROM analytics_events
          WHERE ${COUNTED}
          GROUP BY session_id
          ORDER BY started_at DESC
          LIMIT $2`,
        [since, limit],
      );
      return result.rows.map(toVisit);
    },

    async dailyCounts(since) {
      const result = await pool.query<{ day: string; page_views: number; visitors: number }>(
        `SELECT to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')                AS day,
                (count(*) FILTER (WHERE event_type = 'page_view'))::int             AS page_views,
                count(DISTINCT visitor_hash)::int                                   AS visitors
           FROM analytics_events
          WHERE ${COUNTED}
          GROUP BY day
          ORDER BY day`,
        [since],
      );
      return result.rows.map((row) => ({
        day: row.day,
        pageViews: row.page_views,
        visitors: row.visitors,
      }));
    },

    async topPages(since, limit) {
      const result = await pool.query<{ path: string; views: number; visits: number }>(
        `SELECT path, count(*)::int AS views, count(DISTINCT session_id)::int AS visits
           FROM analytics_events
          WHERE ${COUNTED} AND event_type = 'page_view'
          GROUP BY path
          ORDER BY views DESC, path
          LIMIT $2`,
        [since, limit],
      );
      return result.rows;
    },

    async topClicks(since, limit) {
      const result = await pool.query<{ name: string; clicks: number }>(
        `SELECT event_name AS name, count(*)::int AS clicks
           FROM analytics_events
          WHERE ${COUNTED} AND event_type = 'interaction'
          GROUP BY event_name
          ORDER BY clicks DESC, name
          LIMIT $2`,
        [since, limit],
      );
      return result.rows;
    },
  };
}

function toVisit(row: VisitRow): Visit {
  return {
    startedAt: row.started_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    pageViews: row.page_views,
    clicks: row.clicks,
    paths: row.paths ?? [],
    referrer: row.referrer,
    ref: row.ref,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    organization: row.organization,
    city: row.city,
    countryCode: row.country_code,
    deviceType: row.device_type,
    browser: row.browser,
    os: row.os,
    ipAddress: row.ip_address,
  };
}
