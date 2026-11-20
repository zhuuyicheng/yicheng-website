import type { DependencyHealth } from '@portfolio/shared';

/** A named dependency (Postgres, Redis, ...) that can be probed for liveness. */
export interface DependencyCheck {
  name: string;
  ping: () => Promise<void>;
}

/** `{ status: 'up' | 'down', latencyMs }`, shared with the system status contract. */
export type { DependencyHealth } from '@portfolio/shared';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: Record<string, DependencyHealth>;
}

/** `GET /health/live`: the process can answer. Checks nothing else, on purpose. */
export interface LivenessReport {
  status: 'ok';
}
