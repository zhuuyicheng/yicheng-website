import { EVENT_TYPES } from '@portfolio/shared';
import { z } from 'zod';

/**
 * Telemetry events. See DESIGN.md §7.5 and §8.2.
 *
 * Shapes, in the order an event meets them:
 *   1. `EventRequest`: what a browser sends to POST /api/v1/events (in `@portfolio/shared`).
 *   2. `VisitorDetails`: what the API learns about the visitor (link, browser, IP address).
 *   3. `BufferedEvent`: what the API stores in the Redis buffer. The worker's flusher reads it
 *      back and validates it with the same schema before inserting it into Postgres.
 *   4. `DeadLetteredEvent`: an event the flusher could never insert, kept in the DLQ.
 */

// The request body and the response are the public contract (the web app's beacon builds
// them), so they live in `@portfolio/shared`.
export {
  EVENT_TYPES,
  eventRequestSchema,
  type EventAccepted,
  type EventRequest,
  type EventType,
} from '@portfolio/shared';

// ---------------------------------------------------------------------------------------------
// 2. Visitor details (services/visitor-details.manager.ts). Every field is null when unknown.
// ---------------------------------------------------------------------------------------------

/** From the link the visitor followed, e.g. `/?ref=acme&utm_source=linkedin`. */
export const campaignSchema = z.object({
  ref: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
});

/** From the browser: its user agent, Accept-Language header and time zone. */
export const deviceSchema = z.object({
  browser: z.string().nullable(), // "Chrome"
  os: z.string().nullable(), // "macOS"
  type: z.string().nullable(), // "desktop" | "mobile" | "tablet" | "tv" | "bot"
  language: z.string().nullable(), // "en-SG"
  timezone: z.string().nullable(), // "Asia/Singapore"
});

/** From the IP address, looked up in local GeoIP database files (dal/ip-location.dal.ts). */
export const networkSchema = z.object({
  countryCode: z.string().nullable(), // "SG"
  city: z.string().nullable(), // "Singapore"
  organization: z.string().nullable(), // "Google LLC": who owns the network
});

export type Campaign = z.infer<typeof campaignSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type Network = z.infer<typeof networkSchema>;

export interface VisitorDetails {
  campaign: Campaign;
  device: Device;
  network: Network;
}

export const unknownCampaign = (): Campaign => ({
  ref: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
});
export const unknownDevice = (): Device => ({
  browser: null,
  os: null,
  type: null,
  language: null,
  timezone: null,
});
export const unknownNetwork = (): Network => ({
  countryCode: null,
  city: null,
  organization: null,
});

// ---------------------------------------------------------------------------------------------
// 3. Buffered event (Redis JSON)
// ---------------------------------------------------------------------------------------------

export const bufferedEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(EVENT_TYPES),
  name: z.string().nullable(),
  /** Query string and fragment already stripped. */
  path: z.string(),
  /** Host only, e.g. `news.ycombinator.com`. Browsers rarely send more (DESIGN.md §8.2). */
  referrerHost: z.string().nullable(),
  sessionId: z.string(),
  /** sha256(daily salt + IP + user agent), hex: counts unique visitors per day. */
  visitorHash: z.string(),
  /** Server time (ISO 8601). Client clocks are not trusted. */
  receivedAt: z.iso.datetime(),
  // Added with migration 0004. Events buffered by the previous version do not have these
  // groups; the defaults let the flusher still insert them, with NULL details. Queued data
  // can outlive the code that wrote it, so a new field must be optional when read back.
  campaign: campaignSchema.default(unknownCampaign),
  device: deviceSchema.default(unknownDevice),
  network: networkSchema.default(unknownNetwork),
});

export type BufferedEvent = z.infer<typeof bufferedEventSchema>;

// ---------------------------------------------------------------------------------------------
// 4. Dead-lettered event (Redis JSON, telemetry:events:dlq)
// ---------------------------------------------------------------------------------------------

/**
 * Why the flusher gave up on an event:
 *   - `invalid_payload`: the buffer entry is not valid JSON or not a valid BufferedEvent;
 *   - `insert_failed`: Postgres rejected the row for its data (e.g. a CHECK constraint).
 */
export const DEAD_LETTER_REASONS = ['invalid_payload', 'insert_failed'] as const;
export type DeadLetterReason = (typeof DEAD_LETTER_REASONS)[number];

export const deadLetteredEventSchema = z.object({
  /** The original buffer entry, unchanged, so `npm run dlq:replay` can put it back. */
  payload: z.string(),
  reason: z.enum(DEAD_LETTER_REASONS),
  /** Postgres SQLSTATE for `insert_failed` (e.g. "23514"), otherwise null. */
  errorCode: z.string().nullable(),
  errorMessage: z.string(),
  failedAt: z.iso.datetime(),
});

export type DeadLetteredEvent = z.infer<typeof deadLetteredEventSchema>;
