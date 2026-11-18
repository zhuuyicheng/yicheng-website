import { z } from 'zod';

/**
 * GET /api/v1/admin/system-status (DESIGN.md §7.7): what the API reports about itself. Counts
 * and timings only, never anything about individual visitors. Owner-only, on the /admin page.
 */

export const dependencyHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number(),
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

/** How many items wait in each Redis queue. */
export const queueDepthsSchema = z.object({
  telemetryBuffer: z.number(),
  telemetryDeadLetter: z.number(),
  notificationsReady: z.number(),
  notificationsDelayed: z.number(),
  notificationsDeadLetter: z.number(),
});
export type QueueDepths = z.infer<typeof queueDepthsSchema>;

export const systemStatusSchema = z.object({
  generatedAt: z.string(),
  /** Which API process answered: with two replicas, consecutive polls can reach either. */
  instance: z.string(),
  uptimeSeconds: z.number(),
  dependencies: z.record(z.string(), dependencyHealthSchema),
  http: z.object({
    windowSeconds: z.number(),
    requestCount: z.number(),
    /** Milliseconds; `null` when there were no requests in the window. */
    latencyMs: z.object({ p50: z.number().nullable(), p95: z.number().nullable() }),
  }),
  /** Content cache lookups since this process started. `hitRatio` is `null` before the first. */
  cache: z.object({ hits: z.number(), misses: z.number(), hitRatio: z.number().nullable() }),
  /** `null` when Postgres could not be asked. */
  analytics: z.object({ pageViewsLast24h: z.number().nullable() }),
  /** `null` when Redis could not be asked. */
  queues: queueDepthsSchema.nullable(),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;
