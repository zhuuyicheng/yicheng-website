import { systemStatusSchema } from '@portfolio/shared';
import { z } from 'zod';
import { fetchOwnerData } from './owner-fetch';
import { systemMetricsSchema } from './system-metrics';

/**
 * The /admin system dashboard (DESIGN.md §8.6, §15.5): the API's status for what lives in the
 * datastores, Prometheus for the per-process numbers.
 */

/**
 * The API's status as the dashboard reads it: without its per-process numbers (`instance`,
 * `uptimeSeconds`, `http`, `cache`), which now come from Prometheus. The API still sends them
 * until the next release (DESIGN.md §15.6); an object schema just ignores keys it doesn't name.
 */
export const dashboardStatusSchema = systemStatusSchema.omit({
  instance: true,
  uptimeSeconds: true,
  http: true,
  cache: true,
});
export type DashboardStatus = z.infer<typeof dashboardStatusSchema>;

/**
 * What app/admin/system-status/route.ts answers: each source, or `null` with the reason it
 * couldn't be read, so one failing never hides the other.
 */
export const dashboardDataSchema = z.object({
  status: dashboardStatusSchema.nullable(),
  statusProblem: z.string().nullable(),
  metrics: systemMetricsSchema.nullable(),
  metricsProblem: z.string().nullable(),
});
export type DashboardData = z.infer<typeof dashboardDataSchema>;

/** One poll, checked against the schema above. */
export function fetchDashboard(options: {
  url: string;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<DashboardData> {
  return fetchOwnerData({ ...options, schema: dashboardDataSchema });
}

export interface Health {
  /** `down`: the API isn't answering. `degraded`: something else needs a look. */
  level: 'operational' | 'degraded' | 'down';
  /** For the banner, in plain words. */
  problems: string[];
}

/** Operational when the API answers with every dependency up, and every process answers. */
export function overallHealth(data: DashboardData): Health {
  const problems: string[] = [];
  const are = (names: readonly string[]) => (names.length === 1 ? 'is' : 'are');

  if (data.status === null) {
    problems.push(`the API is not answering (${data.statusProblem ?? 'no reason given'})`);
  } else {
    const down = Object.entries(data.status.dependencies)
      .filter(([, dependency]) => dependency.status === 'down')
      .map(([name]) => name);
    if (down.length > 0) problems.push(`${down.join(', ')} ${are(down)} down`);
  }

  if (data.metrics === null) {
    problems.push(
      `Prometheus is not answering (${data.metricsProblem ?? 'no reason given'}): no traffic numbers`,
    );
  } else {
    const silent = data.metrics.targets.filter((target) => !target.up).map(({ name }) => name);
    if (silent.length > 0) problems.push(`${silent.join(', ')} ${are(silent)} not answering`);
  }

  if (data.status === null) return { level: 'down', problems };
  return { level: problems.length > 0 ? 'degraded' : 'operational', problems };
}

/** The charts' ticks: every 5 minutes. */
export const CHART_TICK_MS = 5 * 60_000;

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

/** `7.5` → `7.5 ms`; `null` (no requests) → `—`. */
export function formatMs(value: number | null): string {
  return value === null ? '—' : `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ms`;
}

/** `0.968` → `96.8 %`; `null` (no lookups) → `—`. */
export function formatRatio(ratio: number | null): string {
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)} %`;
}

/** For "updated 3 s ago". */
export function secondsAgo(at: number, now: number): number {
  return Math.max(0, Math.round((now - at) / 1000));
}

/** A value (or `null`, unknown) at a time (ms since epoch). */
export interface TimePoint {
  at: number;
  value: number | null;
}

/** The axis' start and end (ms) and drawn width. */
export interface TimeScale {
  start: number;
  end: number;
  width: number;
}

/** The x position of time `at` on the axis. */
export function timeX(at: number, scale: TimeScale): number {
  return ((at - scale.start) / (scale.end - scale.start)) * scale.width;
}

/** Multiples of `stepMs` since the epoch: :00, :05… on any clock (zones are quarter hours). */
export function timeTicks(start: number, end: number, stepMs: number): number[] {
  const ticks: number[] = [];
  for (let at = Math.ceil(start / stepMs) * stepMs; at <= end; at += stepMs) {
    ticks.push(at);
  }
  return ticks;
}

/** How far down `value` sits: 0 at `ceiling`, 1 at zero. Shared by the line and the marker. */
export function valueDepth(value: number, ceiling: number): number {
  return 1 - Math.min(Math.max(value, 0), ceiling) / ceiling;
}

/**
 * An SVG path placed by time and scaled 0 → `ceiling`. It breaks at unknown values and at gaps
 * over `maxGapMs` (a hidden tab) rather than draw across time it knows nothing about.
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
    const y = valueDepth(point.value, ceiling) * height;
    path += `${continues ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    previousAt = point.at;
  }
  return path.trim();
}

/** The point nearest `at` in time (the hover crosshair), or `null`. */
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

/** `17:35` on the viewer's clock: the axis labels. */
export function formatClock(at: number): string {
  return CLOCK.format(at);
}

/** A round number just above the largest value, for a clean top label. */
export function niceCeiling(values: readonly (number | null)[]): number {
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  if (max === 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.find((s) => s * magnitude >= max) ?? 10;
  return step * magnitude;
}
