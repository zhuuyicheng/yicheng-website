import { z } from 'zod';

/**
 * GET /api/v1/admin/visitors (DESIGN.md §7.8). A visit is one browser tab's session; its
 * referrer, tags, place and device are the first values seen in it.
 */

/** Days back to summarise; today (UTC) is the first. */
export const visitorSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
});

const count = z.number().int().nonnegative();
const text = z.string().nullable();

export const visitSchema = z.object({
  startedAt: z.string(),
  lastSeenAt: z.string(),
  pageViews: count,
  clicks: count,
  /** Pages in the order viewed (at most 20). */
  paths: z.array(z.string()),
  /** Referring site (host only); `null` = typed in, bookmark or app. */
  referrer: text,
  ref: text,
  utmSource: text,
  utmMedium: text,
  utmCampaign: text,
  organization: text,
  city: text,
  countryCode: text,
  deviceType: text,
  browser: text,
  os: text,
  /** The first IP address seen in the visit; null for older events. */
  ipAddress: text,
});

export const visitorSummarySchema = z.object({
  days: z.number().int().positive(),
  /** Start of the first day counted (UTC midnight), ISO 8601. */
  since: z.string(),
  generatedAt: z.string(),
  /** True when the period had more visits than one summary reads (the newest are kept). */
  truncated: z.boolean(),
  totals: z.object({ pageViews: count, visits: count, clicks: count }),
  /** One entry per UTC day, oldest first, including days without visits. */
  daily: z.array(z.object({ day: z.string(), pageViews: count, visitors: count })),
  referrers: z.array(z.object({ referrer: text, visits: count })),
  campaigns: z.array(
    z.object({ ref: text, utmSource: text, utmMedium: text, utmCampaign: text, visits: count }),
  ),
  locations: z.array(z.object({ countryCode: text, city: text, visits: count })),
  organizations: z.array(
    z.object({
      organization: z.string(),
      countryCode: text,
      visits: count,
      lastSeenAt: z.string(),
    }),
  ),
  pages: z.array(z.object({ path: z.string(), views: count, visits: count })),
  devices: z.array(z.object({ deviceType: text, visits: count })),
  browsers: z.array(z.object({ browser: text, visits: count })),
  clicks: z.array(z.object({ name: z.string(), clicks: count })),
  /** The newest visits first. */
  recentVisits: z.array(visitSchema),
});

export type VisitorSummaryQuery = z.infer<typeof visitorSummaryQuerySchema>;
export type Visit = z.infer<typeof visitSchema>;
export type VisitorSummary = z.infer<typeof visitorSummarySchema>;
