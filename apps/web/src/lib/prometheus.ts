import { z } from 'zod';

/**
 * Prometheus's HTTP API (DESIGN.md §15.5), for the /admin dashboard's numbers. Server only.
 * Values arrive as strings; anything that isn't a finite number (`NaN` with no requests, `+Inf`)
 * becomes `null`, unknown.
 */

const valueSchema = z.tuple([z.number(), z.string()]);
const labelsSchema = z.record(z.string(), z.string());

const vectorResponseSchema = z.object({
  status: z.literal('success'),
  data: z.object({
    resultType: z.literal('vector'),
    result: z.array(z.object({ metric: labelsSchema, value: valueSchema })),
  }),
});

const matrixResponseSchema = z.object({
  status: z.literal('success'),
  data: z.object({
    resultType: z.literal('matrix'),
    result: z.array(z.object({ metric: labelsSchema, values: z.array(valueSchema) })),
  }),
});

/** Prometheus explains a refused query in `error`. */
const errorResponseSchema = z.object({ status: z.literal('error'), error: z.string() });

/** One series' value now. */
export interface InstantSample {
  labels: Record<string, string>;
  value: number | null;
}

/** One series over time; `at` in ms since the epoch. */
export interface RangeSeries {
  labels: Record<string, string>;
  points: { at: number; value: number | null }[];
}

export interface PrometheusClient {
  instant: (expr: string) => Promise<InstantSample[]>;
  range: (
    expr: string,
    window: { start: number; end: number; stepSeconds: number },
  ) => Promise<RangeSeries[]>;
}

/** No answer within this, and the dashboard says so instead of waiting. */
export const PROMETHEUS_TIMEOUT_MS = 3_000;

export function createPrometheusClient(options: {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}): PrometheusClient {
  const { baseUrl, fetch, timeoutMs = PROMETHEUS_TIMEOUT_MS } = options;

  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}?${new URLSearchParams(params).toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = await response.json().catch(() => null);
    const refused = errorResponseSchema.safeParse(body);
    if (refused.success) {
      throw new Error(`Prometheus refused the query: ${refused.data.error}`);
    }
    if (!response.ok) {
      throw new Error(`Prometheus answered HTTP ${String(response.status)}`);
    }
    return body;
  }

  return {
    async instant(expr) {
      const body = vectorResponseSchema.parse(await get('/api/v1/query', { query: expr }));
      return body.data.result.map((series) => ({
        labels: series.metric,
        value: toNumber(series.value[1]),
      }));
    },
    async range(expr, { start, end, stepSeconds }) {
      const body = matrixResponseSchema.parse(
        await get('/api/v1/query_range', {
          query: expr,
          start: String(start / 1000),
          end: String(end / 1000),
          step: String(stepSeconds),
        }),
      );
      return body.data.result.map((series) => ({
        labels: series.metric,
        points: series.values.map(([at, value]) => ({ at: at * 1000, value: toNumber(value) })),
      }));
    },
  };
}

function toNumber(value: string): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
