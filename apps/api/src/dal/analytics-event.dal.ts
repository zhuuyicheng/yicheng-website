import type { AnalyticsEventRow } from '../dao/analytics-event.dao.js';
import type { PostgresPool } from '../infra/postgres.js';
import type { BufferedEvent } from '../schema/analytics-event.schema.js';

/** `analytics_events` (DESIGN.md §5.3): the flusher writes, the status report counts. */
export interface AnalyticsEventDal {
  /**
   * One statement for the batch; returns how many rows were new. Known ids are skipped, so a
   * batch inserted twice (after a crash) is harmless. One bad row fails the whole statement.
   */
  insertBatch: (events: readonly BufferedEvent[]) => Promise<number>;
  /** Page views received in the last `hours` hours. */
  countPageViews: (hours: number) => Promise<number>;
}

/** `inserted_at` is left to its DEFAULT now(). */
type NewEventRow = Omit<AnalyticsEventRow, 'inserted_at'>;

/** A `Record` over the row's keys, so the compiler insists on every column. */
const COLUMN_TYPES: Record<keyof NewEventRow, string> = {
  id: 'uuid',
  event_type: 'text',
  event_name: 'text',
  path: 'text',
  referrer_host: 'text',
  session_id: 'text',
  visitor_hash: 'text',
  received_at: 'timestamptz',
  ref: 'text',
  utm_source: 'text',
  utm_medium: 'text',
  utm_campaign: 'text',
  browser: 'text',
  os: 'text',
  device_type: 'text',
  language: 'text',
  timezone: 'text',
  country_code: 'text',
  city: 'text',
  organization: 'text',
  ip_address: 'inet',
};

const COLUMNS = Object.keys(COLUMN_TYPES) as (keyof NewEventRow)[];

/**
 * One array parameter per column, turned back into rows by `unnest`: any batch size is one
 * statement with 21 parameters.
 */
const INSERT_EVENTS = `
  INSERT INTO analytics_events (${COLUMNS.join(', ')})
  SELECT * FROM unnest(${COLUMNS.map((column, i) => `$${i + 1}::${COLUMN_TYPES[column]}[]`).join(', ')})
  ON CONFLICT (id) DO NOTHING`;

export function createAnalyticsEventDal(pool: PostgresPool): AnalyticsEventDal {
  return {
    async insertBatch(events) {
      const rows = events.map(toRow);
      const valuesPerColumn = COLUMNS.map((column) => rows.map((row) => row[column]));
      const result = await pool.query(INSERT_EVENTS, valuesPerColumn);
      return result.rowCount ?? 0;
    },

    async countPageViews(hours) {
      // Cheap thanks to the BRIN index on received_at. ::int, since pg returns bigint as a string.
      const result = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM analytics_events
          WHERE event_type = 'page_view' AND received_at > now() - make_interval(hours => $1)`,
        [hours],
      );
      return result.rows[0]?.count ?? 0;
    },
  };
}

/** Schema (camelCase, nested) → row (snake_case, flat). */
function toRow(event: BufferedEvent): NewEventRow {
  return {
    id: event.id,
    event_type: event.type,
    event_name: event.name,
    path: event.path,
    referrer_host: event.referrerHost,
    session_id: event.sessionId,
    visitor_hash: event.visitorHash,
    received_at: new Date(event.receivedAt),
    ref: event.campaign.ref,
    utm_source: event.campaign.utmSource,
    utm_medium: event.campaign.utmMedium,
    utm_campaign: event.campaign.utmCampaign,
    browser: event.device.browser,
    os: event.device.os,
    device_type: event.device.type,
    language: event.device.language,
    timezone: event.device.timezone,
    country_code: event.network.countryCode,
    city: event.network.city,
    organization: event.network.organization,
    ip_address: event.ipAddress,
  };
}
