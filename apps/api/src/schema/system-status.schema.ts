import type { DependencyHealth } from './health.schema.js';

/**
 * GET /api/v1/system/status: what the API reports about itself (DESIGN.md §7.7). Counts and
 * timings only, never anything about individual visitors: the dashboard showing it is public.
 */

/** How many items wait in each Redis queue. */
export interface QueueDepths {
  telemetryBuffer: number;
  telemetryDeadLetter: number;
  notificationsReady: number;
  notificationsDelayed: number;
  notificationsDeadLetter: number;
}

export interface SystemStatus {
  generatedAt: string;
  /** Which API process answered: with two replicas, consecutive polls can reach either. */
  instance: string;
  uptimeSeconds: number;
  dependencies: Record<string, DependencyHealth>;
  http: {
    windowSeconds: number;
    requestCount: number;
    /** Milliseconds; `null` when there were no requests in the window. */
    latencyMs: { p50: number | null; p95: number | null };
  };
  /** Content cache lookups since this process started. `hitRatio` is `null` before the first. */
  cache: { hits: number; misses: number; hitRatio: number | null };
  /** `null` when Postgres could not be asked. */
  analytics: { pageViewsLast24h: number | null };
  /** `null` when Redis could not be asked. */
  queues: QueueDepths | null;
}
