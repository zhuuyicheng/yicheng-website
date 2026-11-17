import { z } from 'zod';

/**
 * Telemetry events. See DESIGN.md §7.5 and §8.2.
 *
 * Two shapes:
 *   1. `EventRequest`: what a browser sends to POST /api/v1/events. Untrusted, so strict.
 *   2. `BufferedEvent`: what the API stores in the Redis buffer after normalising and hashing.
 *      The flusher (Phase 3, step 4) reads it back and validates it with the same schema.
 */

export const EVENT_TYPES = ['page_view', 'interaction'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ---------------------------------------------------------------------------------------------
// 1. Request body
// ---------------------------------------------------------------------------------------------

/** Browsers report "no referrer" as an empty string; treat it like a missing value. */
function emptyStringToNull(value: unknown): unknown {
  return value === '' ? null : value;
}

export const eventRequestSchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    path: z.string().max(512).startsWith('/', 'must start with "/"'),
    referrer: z
      .preprocess(
        emptyStringToNull,
        z
          .url({ protocol: /^https?$/ })
          .max(1024)
          .nullable(),
      )
      .optional(),
    sessionId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/, 'must be 8-64 letters, digits, "_" or "-"'),
    name: z
      .string()
      .regex(/^[a-z0-9:_-]{1,64}$/, 'must be 1-64 lowercase letters, digits, ":", "_" or "-"')
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

// ---------------------------------------------------------------------------------------------
// 2. Buffered event (Redis JSON)
// ---------------------------------------------------------------------------------------------

export const bufferedEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(EVENT_TYPES),
  name: z.string().nullable(),
  /** Query string and fragment already stripped. */
  path: z.string(),
  /** Host only, e.g. `news.ycombinator.com`; never the full referring URL. */
  referrerHost: z.string().nullable(),
  sessionId: z.string(),
  /** sha256(daily salt + IP + user agent), hex. The raw IP and user agent are not kept. */
  visitorHash: z.string(),
  /** Server time (ISO 8601). Client clocks are not trusted. */
  receivedAt: z.iso.datetime(),
});

export type BufferedEvent = z.infer<typeof bufferedEventSchema>;

// ---------------------------------------------------------------------------------------------
// 3. Response
// ---------------------------------------------------------------------------------------------

/** `202 Accepted` body: the id the event will have in `analytics_events`. */
export interface EventAccepted {
  eventId: string;
}
