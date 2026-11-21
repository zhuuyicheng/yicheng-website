import { z } from 'zod';

/**
 * POST /api/v1/events (DESIGN.md §7.5): what the web app's page-view beacon sends.
 */

export const EVENT_TYPES = ['page_view', 'interaction'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Browsers report "no referrer" as an empty string; treat it like a missing value. */
function emptyStringToNull(value: unknown): unknown {
  return value === '' ? null : value;
}

/** IANA time zone names: "UTC", "Asia/Singapore", "America/Argentina/Buenos_Aires", "Etc/GMT+8". */
const TIME_ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** Limits the API enforces; the beacon trims to them rather than having an event refused. */
export const EVENT_LIMITS = { path: 512, referrer: 1024 } as const;

/** Interaction names: lowercase, e.g. `click:linkedin-link`. */
export const INTERACTION_NAME = /^[a-z0-9:_-]{1,64}$/;

export const eventRequestSchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    /** May include a query string; tagged-link parameters (?ref=, utm_*) are kept from it. */
    path: z.string().max(EVENT_LIMITS.path).startsWith('/', 'must start with "/"'),
    referrer: z
      .preprocess(
        emptyStringToNull,
        z
          .url({ protocol: /^https?$/ })
          .max(EVENT_LIMITS.referrer)
          .nullable(),
      )
      .optional(),
    sessionId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/, 'must be 8-64 letters, digits, "_" or "-"'),
    name: z
      .string()
      .regex(INTERACTION_NAME, 'must be 1-64 lowercase letters, digits, ":", "_" or "-"')
      .nullable()
      .optional(),
    /** The browser's time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). */
    timezone: z
      .string()
      .max(64)
      .regex(TIME_ZONE, 'must be an IANA time zone such as "Asia/Singapore"')
      .nullable()
      .optional(),
  })
  .superRefine((event, context) => {
    // Mirrors the SQL CHECK `analytics_events_name_iff_interaction`, so a bad event is
    // rejected with a 400 here instead of failing later in the worker.
    const hasName = event.name !== null && event.name !== undefined;
    if (event.type === 'interaction' && !hasName) {
      context.addIssue({ code: 'custom', path: ['name'], message: 'is required for interactions' });
    }
    if (event.type === 'page_view' && hasName) {
      context.addIssue({ code: 'custom', path: ['name'], message: 'must be null for page views' });
    }
  });

export type EventRequest = z.infer<typeof eventRequestSchema>;

/** `202` body: the id the event will have in `analytics_events`. */
export const eventAcceptedSchema = z.object({ eventId: z.string() });
export type EventAccepted = z.infer<typeof eventAcceptedSchema>;
