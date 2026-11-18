import { systemStatusSchema, type SystemStatus } from '@portfolio/shared';

/**
 * The owner's live system dashboard (on /admin): fetch the API's self-report (DESIGN.md §7.7)
 * and turn it into what the page shows. No React, so it can be unit-tested.
 */

/**
 * The status as the browser gets it: from the web server's owner-only route
 * (app/admin/system-status/route.ts), which asks the API with the admin token. Validated
 * against the shared contract.
 */
export async function fetchStatus(options: {
  url: string;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<SystemStatus> {
  const response = await options.fetch(options.url, {
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

/** The charts' time axis: the last 30 minutes, with a labelled tick every 5 minutes. */
export const CHART_WINDOW_MS = 30 * 60_000;
export const CHART_TICK_MS = 5 * 60_000;

/** Adds `sample` and drops those older than `windowMs` before it: the chart's time window. */
export function appendSample(
  history: readonly Sample[],
  sample: Sample,
  windowMs: number,
): Sample[] {
  return [...history, sample].filter((kept) => kept.at > sample.at - windowMs);
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

/** One point of a chart's line: a value (or `null`, unknown) at a time (ms since epoch). */
export interface TimePoint {
  at: number;
  value: number | null;
}

/** Where a chart's time axis starts and ends (ms since epoch), and how wide it is drawn. */
export interface TimeScale {
  start: number;
  end: number;
  width: number;
}

/** The x position of time `at` on the axis. */
export function timeX(at: number, scale: TimeScale): number {
  return ((at - scale.start) / (scale.end - scale.start)) * scale.width;
}

/**
 * Tick times between `start` and `end`: every multiple of `stepMs` since the epoch. With a
 * 5-minute step these fall on :00, :05, :10 … of the viewer's clock, because every time zone
 * is offset from UTC by whole quarter hours.
 */
export function timeTicks(start: number, end: number, stepMs: number): number[] {
  const ticks: number[] = [];
  for (let at = Math.ceil(start / stepMs) * stepMs; at <= end; at += stepMs) {
    ticks.push(at);
  }
  return ticks;
}

/**
 * An SVG path through `points`, placed by time (x) and scaled from 0 (bottom) to `ceiling`
 * (top). The line breaks at unknown values and at gaps longer than `maxGapMs` (polling pauses
 * while the tab is hidden) instead of drawing a straight line across time it knows nothing of.
 */
export function timeLinePath(
  points: readonly TimePoint[],
  options: TimeScale & { height: number; ceiling: number; maxGapMs: number },
): string {
  const { height, ceiling, maxGapMs } = options;
  if (ceiling <= 0) return '';
  let path = '';
  let previousAt: number | null = null;
  for (const point of points) {
    if (point.value === null) {
      previousAt = null;
      continue;
    }
    const continues = previousAt !== null && point.at - previousAt <= maxGapMs;
    const x = timeX(point.at, options);
    const y = height - (Math.min(point.value, ceiling) / ceiling) * height;
    path += `${continues ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    previousAt = point.at;
  }
  return path.trim();
}

/** The point closest in time to `at` (for the hover crosshair), or `null` if there is none. */
export function nearestPoint(points: readonly TimePoint[], at: number): TimePoint | null {
  let best: TimePoint | null = null;
  for (const point of points) {
    if (best === null || Math.abs(point.at - at) < Math.abs(best.at - at)) {
      best = point;
    }
  }
  return best;
}

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `17:35` in the viewer's time zone: the time axis' labels. */
export function formatClock(at: number): string {
  return CLOCK.format(at);
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
