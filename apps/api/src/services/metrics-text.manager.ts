import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';

/** The Prometheus text and its content-type header. */
export interface MetricsText {
  contentType: string;
  body: string;
}

/** What GET /metrics asks for (DESIGN.md §7.7): the API's system status, or the worker's. */
export interface MetricsTextManager {
  getMetricsText: (log: Logger) => Promise<MetricsText>;
}

/** Every metric on the registry, as it is now. */
export async function renderMetricsText(metrics: Metrics): Promise<MetricsText> {
  return { contentType: metrics.registry.contentType, body: await metrics.registry.metrics() };
}

/** The worker's (DESIGN.md §15.2): nothing to refresh first, unlike the API's queue gauges. */
export function createMetricsTextManager(metrics: Metrics): MetricsTextManager {
  return { getMetricsText: () => renderMetricsText(metrics) };
}
