import { systemStatusSchema, type SystemStatus } from '@portfolio/shared';
import { z } from 'zod';
import { fetchOwnerData } from './owner-fetch';

/** The /admin system dashboard: fetch each replica's report (DESIGN.md §7.7) and shape it. */

/**
 * What app/admin/system-status/route.ts answers: each API replica's status by name, `null` if
 * it didn't answer. Each replica counts only its own requests, so the page needs them all.
 */
export const replicaStatusesSchema = z.object({
  replicas: z
    .array(z.object({ name: z.string().min(1), status: systemStatusSchema.nullable() }))
    .min(1),
});
export type ReplicaStatuses = z.infer<typeof replicaStatusesSchema>;
export type ReplicaStatus = ReplicaStatuses['replicas'][number];

/** The replicas' statuses, each checked against the shared contract. */
export async function fetchStatus(options: {
  url: string;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<ReplicaStatus[]> {
  const statuses = await fetchOwnerData({ ...options, schema: replicaStatusesSchema });
  return statuses.replicas;
}

export interface Health {
  level: 'operational' | 'degraded';
  /** Names of the dependencies that are down, e.g. `["redis"]`. */
  down: string[];
  /** Names of the API replicas that did not answer, e.g. `["api-2"]`. */
  silent: string[];
}

/** Operational when every dependency is up and every replica answered. */
export function overallHealth(status: SystemStatus, silent: readonly string[] = []): Health {
  const down = Object.entries(status.dependencies)
    .filter(([, health]) => health.status === 'down')
    .map(([name]) => name);
  const healthy = down.length === 0 && silent.length === 0;
  return { level: healthy ? 'operational' : 'degraded', down, silent: [...silent] };
}

/** For the banner: `redis is down · api-2 is not answering (…)`. */
export function healthProblems(health: Health): string {
  const verb = (names: readonly string[]) => (names.length === 1 ? 'is' : 'are');
  const problems: string[] = [];
  if (health.down.length > 0) {
    problems.push(`${health.down.join(', ')} ${verb(health.down)} down`);
  }
  if (health.silent.length > 0) {
    problems.push(
      `${health.silent.join(', ')} ${verb(health.silent)} not answering (left out of the numbers)`,
    );
  }
  return problems.join(' · ');
}

/** The whole API's numbers, from one poll's answers. */
export interface CombinedStatus {
  /** Dependencies, queues and page views, from the first replica that answered (they're shared). */
  shared: SystemStatus;
  /** By name. */
  answered: string[];
  silent: string[];
  /** The most recently started replica's. */
  uptimeSeconds: number;
  /** Added up: every request reaches exactly one replica. */
  requestCount: number;
  /**
   * The slower replica's: not the exact percentile of all requests (that needs every duration),
   * but a safe upper bound.
   */
  p50: number | null;
  p95: number | null;
  cacheHits: number;
  cacheMisses: number;
  /** hits ÷ (hits + misses); `null` before the first lookup. */
  hitRatio: number | null;
}

/**
 * One poll's answers combined; `null` if none answered. A silent replica is named, not guessed;
 * while it's down Caddy sends everyone to the others, so their counts hold nearly everything.
 */
export function combineReplicas(replicas: readonly ReplicaStatus[]): CombinedStatus | null {
  const answering = replicas.flatMap((replica) =>
    replica.status === null ? [] : [{ name: replica.name, status: replica.status }],
  );
  const first = answering[0];
  if (first === undefined) {
    return null;
  }
  const statuses = answering.map((replica) => replica.status);
  const sum = (pick: (status: SystemStatus) => number) =>
    statuses.reduce((total, status) => total + pick(status), 0);
  const slowest = (pick: (status: SystemStatus) => number | null) => {
    const known = statuses.map(pick).filter((value): value is number => value !== null);
    return known.length === 0 ? null : Math.max(...known);
  };
  const cacheHits = sum((status) => status.cache.hits);
  const cacheMisses = sum((status) => status.cache.misses);
  const lookups = cacheHits + cacheMisses;
  return {
    shared: first.status,
    answered: answering.map((replica) => replica.name),
    silent: replicas.filter((replica) => replica.status === null).map((replica) => replica.name),
    uptimeSeconds: Math.min(...statuses.map((status) => status.uptimeSeconds)),
    requestCount: sum((status) => status.http.requestCount),
    p50: slowest((status) => status.http.latencyMs.p50),
    p95: slowest((status) => status.http.latencyMs.p95),
    cacheHits,
    cacheMisses,
    hitRatio: lookups === 0 ? null : cacheHits / lookups,
  };
}

/** One chart point: the status at `at` (ms since epoch). */
export interface Sample {
  at: number;
  p95: number | null;
  requests: number;
}

/** The charts' axis: the last 30 minutes, a tick every 5. */
export const CHART_WINDOW_MS = 30 * 60_000;
export const CHART_TICK_MS = 5 * 60_000;

/** Adds `sample` and drops those older than `windowMs`. */
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
