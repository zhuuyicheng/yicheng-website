/** Request durations of the last `windowSeconds`, summarised. */
export interface LatencySnapshot {
  windowSeconds: number;
  requestCount: number;
  /** Milliseconds, 1 decimal; `null` with no requests in the window. */
  p50: number | null;
  p95: number | null;
}

/**
 * Recent request durations, for the status report's p50/p95 (DESIGN.md §7.7). A Prometheus
 * histogram can't say "the last 5 minutes" on its own. A ring buffer keeps memory constant;
 * past `capacity` requests per window, only the latest are counted.
 */
export interface RollingLatency {
  record: (durationMs: number) => void;
  snapshot: () => LatencySnapshot;
}

export interface RollingLatencyOptions {
  windowMs?: number;
  capacity?: number;
  /** For tests. */
  now?: () => number;
}

export function createRollingLatency(options: RollingLatencyOptions = {}): RollingLatency {
  const { windowMs = 5 * 60 * 1000, capacity = 10_000, now = Date.now } = options;
  const recordedAt = new Float64Array(capacity);
  const durations = new Float64Array(capacity);
  let next = 0; // where the next sample goes
  let size = 0; // how many slots hold a sample

  return {
    record(durationMs) {
      recordedAt[next] = now();
      durations[next] = durationMs;
      next = (next + 1) % capacity;
      size = Math.min(size + 1, capacity);
    },

    snapshot() {
      const since = now() - windowMs;
      const recent: number[] = [];
      for (let i = 0; i < size; i++) {
        if ((recordedAt[i] ?? 0) > since) {
          recent.push(durations[i] ?? 0);
        }
      }
      recent.sort((a, b) => a - b);
      return {
        windowSeconds: windowMs / 1000,
        requestCount: recent.length,
        p50: percentile(recent, 50),
        p95: percentile(recent, 95),
      };
    },
  };
}

/** Nearest-rank percentile of sorted values: with 20 requests, p95 is the 19th fastest. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  const value = sorted[Math.max(rank, 1) - 1] ?? 0;
  return Math.round(value * 10) / 10;
}
