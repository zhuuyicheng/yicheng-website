import { z } from 'zod';

/**
 * GET /api/v1/admin/system-status (DESIGN.md §7.7): what the datastores say, the same whichever
 * replica answers. Per-process numbers (requests, latency, cache, uptime) are Prometheus's job
 * (§15.5). Counts only, nothing about individual visitors.
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
  dependencies: z.record(z.string(), dependencyHealthSchema),
  /** `null` when Postgres could not be asked. */
  analytics: z.object({ pageViewsLast24h: z.number().nullable() }),
  /** `null` when Redis could not be asked. */
  queues: queueDepthsSchema.nullable(),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;
