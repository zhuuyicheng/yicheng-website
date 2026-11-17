/** A named dependency (Postgres, Redis, ...) that can be probed for liveness. */
export interface DependencyCheck {
  name: string;
  ping: () => Promise<void>;
}

export interface DependencyHealth {
  status: 'up' | 'down';
  latencyMs: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: Record<string, DependencyHealth>;
}
