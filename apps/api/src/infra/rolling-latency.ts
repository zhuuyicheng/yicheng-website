/** Request durations of the last `windowSeconds`, summarised. */
export interface LatencySnapshot {
  windowSeconds: number;
  requestCount: number;
  /** Milliseconds, 1 decimal. `null` when there were no requests in the window. */
  p50: number | null;
  p95: number | null;
}

/**
 * Remembers how long recent requests took, to answer "how fast is the API right now?"
 * (DESIGN.md §7.7, the system status endpoint).
 *
 * Why not read this from the Prometheus histogram: a histogram only ever adds up, since the
 * process started, so it cannot say "the last 5 minutes" by itself (Prometheus computes that
 * on its side, from many scrapes). This keeps the recent samples in memory instead.
 *
 * A ring buffer: a fixed-size array where each new sample overwrites the oldest one, so
 * memory stays constant however busy the API gets. Beyond `capacity` requests per window, the
 * snapshot covers only the latest `capacity` of them.
 */
export interface RollingLatency {
  record: (durationMs: number) => void;
  snapshot: () => LatencySnapshot;
}

export interface RollingLatencyOptions {
  windowMs?: number;
  capacity?: number;
  /** Injectable for tests. */
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

/**
 * Nearest-rank percentile of sorted values: p95 is the value 95 % of requests were at or
 * below. With 20 requests, that is the 19th fastest.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  const value = sorted[Math.max(rank, 1) - 1] ?? 0;
  return Math.round(value * 10) / 10;
}
