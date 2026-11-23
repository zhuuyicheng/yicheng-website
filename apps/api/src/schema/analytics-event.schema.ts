import { EVENT_TYPES } from '@portfolio/shared';
import { z } from 'zod';

/**
 * Telemetry events (DESIGN.md §7.5, §8.2), in the order an event meets them: the request
 * (shared), visitor details, the buffered event (Redis), and the dead letter.
 */

// The request and response are the public contract (the beacon builds them).
export {
  EVENT_TYPES,
  eventRequestSchema,
  type EventAccepted,
  type EventRequest,
  type EventType,
} from '@portfolio/shared';

// Visitor details (services/visitor-details.manager.ts); null when unknown.

/** From the link the visitor followed, e.g. `/?ref=acme&utm_source=linkedin`. */
export const campaignSchema = z.object({
  ref: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
});

/** From the user agent, Accept-Language and time zone. */
export const deviceSchema = z.object({
  browser: z.string().nullable(), // "Chrome"
  os: z.string().nullable(), // "macOS"
  type: z.string().nullable(), // "desktop" | "mobile" | "tablet" | "tv" | "bot"
  language: z.string().nullable(), // "en-SG"
  timezone: z.string().nullable(), // "Asia/Singapore"
});

/** From the IP address, via the local GeoIP files. */
export const networkSchema = z.object({
  countryCode: z.string().nullable(), // "SG"
  city: z.string().nullable(), // "Singapore"
  organization: z.string().nullable(), // "Google LLC": owner of the network
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

// Buffered event (Redis JSON)

export const bufferedEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(EVENT_TYPES),
  name: z.string().nullable(),
  /** Without query string or fragment. */
  path: z.string(),
  /** Host only, e.g. `news.ycombinator.com` (browsers rarely send more). */
  referrerHost: z.string().nullable(),
  sessionId: z.string(),
  /** sha256(daily salt + IP + user agent): unique visitors per day. */
  visitorHash: z.string(),
  /** Server time (ISO 8601); client clocks aren't trusted. */
  receivedAt: z.iso.datetime(),
  // Migration 0004. Queued data can outlive the code that wrote it, so new fields default when
  // read back (older events get NULL details).
  campaign: campaignSchema.default(unknownCampaign),
  device: deviceSchema.default(unknownDevice),
  network: networkSchema.default(unknownNetwork),
  // Migration 0007: the visitor's IP (DESIGN.md §12), null if invalid or from older events.
  ipAddress: z.string().nullable().default(null),
});

export type BufferedEvent = z.infer<typeof bufferedEventSchema>;

// Dead-lettered event (Redis JSON, telemetry:events:dlq)

/** `invalid_payload`: unreadable entry. `insert_failed`: Postgres refused the data. */
export const DEAD_LETTER_REASONS = ['invalid_payload', 'insert_failed'] as const;
export type DeadLetterReason = (typeof DEAD_LETTER_REASONS)[number];

export const deadLetteredEventSchema = z.object({
  /** The buffer entry, unchanged, so `dlq:replay` can put it back. */
  payload: z.string(),
  reason: z.enum(DEAD_LETTER_REASONS),
  /** SQLSTATE for `insert_failed` (e.g. "23514"), else null. */
  errorCode: z.string().nullable(),
  errorMessage: z.string(),
  failedAt: z.iso.datetime(),
});

export type DeadLetteredEvent = z.infer<typeof deadLetteredEventSchema>;
