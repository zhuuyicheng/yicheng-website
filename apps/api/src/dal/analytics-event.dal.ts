import type { AnalyticsEventRow } from '../dao/analytics-event.dao.js';
import type { PostgresPool } from '../infra/postgres.js';
import type { BufferedEvent } from '../schema/analytics-event.schema.js';

/** Postgres DAL for `analytics_events` (DESIGN.md §5.3). The worker's flusher writes through it. */
export interface AnalyticsEventDal {
  /**
   * Inserts the events with ONE statement and returns how many rows were new. Ids already in
   * the table are skipped (`ON CONFLICT (id) DO NOTHING`), so inserting a batch twice (after a
   * crash) is harmless. All or nothing: one bad row makes the whole statement fail.
   */
  insertBatch: (events: readonly BufferedEvent[]) => Promise<number>;
}

/** `inserted_at` is left to its DEFAULT now(). */
type NewEventRow = Omit<AnalyticsEventRow, 'inserted_at'>;

/**
 * Each column's Postgres type. Typed as a `Record` over the row's keys, so the compiler refuses
 * to build until every column of the DAO is listed here.
 */
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
};

const COLUMNS = Object.keys(COLUMN_TYPES) as (keyof NewEventRow)[];

/**
 * One parameter per COLUMN (an array of that column's values, one per event), not one per
 * value. `unnest` turns the arrays back into rows, so a batch of 1 or 1000 events is one
 * statement with 20 parameters. The generated SQL reads:
 *
 *   INSERT INTO analytics_events (id, event_type, event_name, ...)
 *   SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], ...)
 *   ON CONFLICT (id) DO NOTHING
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
  };
}

/** Schema (camelCase, nested) → row (snake_case, flat): the reverse of a read mapper. */
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
  };
}
