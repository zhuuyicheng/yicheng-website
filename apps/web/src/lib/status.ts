import { systemStatusSchema, type SystemStatus } from '@portfolio/shared';

/**
 * The live dashboard's logic (app/status): fetch the API's self-report (DESIGN.md §7.7) and
 * turn it into what the page shows. No React, so it can be unit-tested.
 */

/** GET /api/v1/system/status from the browser, validated against the shared contract. */
export async function fetchStatus(options: {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<SystemStatus> {
  const response = await options.fetch(`${options.baseUrl}/api/v1/system/status`, {
    cache: 'no-store',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`status endpoint answered ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  const parsed = systemStatusSchema.safeParse(
    typeof body === 'object' && body !== null && 'data' in body ? body.data : undefined,
  );
  if (!parsed.success) {
    throw new Error('status endpoint answered something unexpected');
  }
  return parsed.data;
}

export interface Health {
  level: 'operational' | 'degraded';
  /** Names of the dependencies that are down, e.g. `["redis"]`. */
  down: string[];
}

/** Operational when every dependency is up. */
export function overallHealth(status: SystemStatus): Health {
  const down = Object.entries(status.dependencies)
    .filter(([, health]) => health.status === 'down')
    .map(([name]) => name);
  return { level: down.length === 0 ? 'operational' : 'degraded', down };
}

/** One point of the charts: what the status said at `at` (ms since epoch). */
export interface Sample {
  at: number;
  p95: number | null;
  requests: number;
}

/** Keeps the newest `max` samples: the charts show the last few minutes the page was open. */
export function appendSample(history: readonly Sample[], sample: Sample, max: number): Sample[] {
  return [...history, sample].slice(-max);
}

/** `93784` → `1d 2h`, `3720` → `1h 2m`, `42` → `42s`: the two largest units. */
export function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  if (days > 0) return `${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}m ${String(s % 60)}s`;
  return `${String(s)}s`;
}

/** `7.5` → `7.5 ms`; `null` (no requests in the window) → `—`. */
export function formatMs(value: number | null): string {
  return value === null ? '—' : `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ms`;
}

/** `0.968` → `96.8 %`; `null` (no lookups yet) → `—`. */
export function formatRatio(ratio: number | null): string {
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)} %`;
}

/** Seconds since the last successful update, for "updated 3 s ago". */
export function secondsAgo(at: number, now: number): number {
  return Math.max(0, Math.round((now - at) / 1000));
}

/**
 * An SVG path through `values` in a `width` × `height` box: x spread evenly, y scaled from 0
 * (bottom) to `ceiling` (top). Gaps (`null`) break the line instead of pretending to be zero.
 */
export function linePath(
  values: readonly (number | null)[],
  width: number,
  height: number,
  ceiling: number,
): string {
  if (values.length === 0 || ceiling <= 0) return '';
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  let path = '';
  let penDown = false;
  values.forEach((value, index) => {
    if (value === null) {
      penDown = false;
      return;
    }
    const x = values.length > 1 ? index * step : width / 2;
    const y = height - (Math.min(value, ceiling) / ceiling) * height;
    path += `${penDown ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    penDown = true;
  });
  return path.trim();
}

/** A round number just above the largest value, so the chart's top label reads cleanly. */
export function niceCeiling(values: readonly (number | null)[]): number {
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  if (max === 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.find((s) => s * magnitude >= max) ?? 10;
  return step * magnitude;
}
