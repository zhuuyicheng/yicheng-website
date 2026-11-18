import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

/**
 * Every Prometheus metric the API records, on one registry. See DESIGN.md §8.5.
 *
 * Created by the composition root and passed down (no global registry), so each test gets a
 * fresh set of counters. Phase 5 exposes `registry` on `GET /metrics`.
 */
export interface Metrics {
  registry: Registry;
  cacheRequests: Counter<'cache' | 'result'>;
  cacheErrors: Counter<'operation'>;
  redisReconnects: Counter<'client'>;
  postgresPoolErrors: Counter;
  telemetryEventsIngested: Counter<'type'>;
  telemetryEventsRejected: Counter<'reason'>;
  telemetryEventsFlushed: Counter;
  telemetryFlushFailures: Counter<'kind'>;
  telemetryEventsDeadLettered: Counter<'reason'>;
}

/** Why POST /api/v1/events refused an event (every refusal is a 503). */
export type TelemetryRejectReason = 'buffer_full' | 'redis_unavailable';

/**
 * Why a flush did not go cleanly (DESIGN.md §8.2):
 *   - `transient`: Postgres or Redis was unavailable; the batch is retried after a backoff;
 *   - `permanent`: Postgres rejected the batch for its data; rows were retried one by one
 *     and the bad ones dead-lettered;
 *   - `unexpected`: any other error (a bug); logged as an error, retried after a backoff.
 */
export type TelemetryFlushFailureKind = 'transient' | 'permanent' | 'unexpected';

export interface MetricsOptions {
  /** CPU, memory, event-loop lag, ... Only worth collecting in a real process. */
  collectProcessMetrics?: boolean;
}

export function createMetrics(options: MetricsOptions = {}): Metrics {
  const registry = new Registry();
  if (options.collectProcessMetrics === true) {
    collectDefaultMetrics({ register: registry });
  }

  return {
    registry,
    cacheRequests: new Counter({
      name: 'cache_requests_total',
      help: 'Cache lookups by cache name and result (hit or miss).',
      labelNames: ['cache', 'result'],
      registers: [registry],
    }),
    cacheErrors: new Counter({
      name: 'cache_errors_total',
      help: 'Cache operations that failed and fell back to Postgres (read, write, decode).',
      labelNames: ['operation'],
      registers: [registry],
    }),
    redisReconnects: new Counter({
      name: 'redis_reconnects_total',
      help: 'Redis reconnection attempts, by client connection name.',
      labelNames: ['client'],
      registers: [registry],
    }),
    postgresPoolErrors: new Counter({
      name: 'postgres_pool_errors_total',
      help: 'Errors emitted by idle Postgres pool clients (e.g. the server restarted).',
      registers: [registry],
    }),
    telemetryEventsIngested: new Counter({
      name: 'telemetry_events_ingested_total',
      help: 'Events accepted into the Redis buffer, by event type.',
      labelNames: ['type'],
      registers: [registry],
    }),
    telemetryEventsRejected: new Counter({
      name: 'telemetry_events_rejected_total',
      help: 'Events refused with 503, by reason (buffer_full, redis_unavailable).',
      labelNames: ['reason'],
      registers: [registry],
    }),
    telemetryEventsFlushed: new Counter({
      name: 'telemetry_events_flushed_total',
      help: 'Events the worker inserted into Postgres (re-inserted duplicates not counted).',
      registers: [registry],
    }),
    telemetryFlushFailures: new Counter({
      name: 'telemetry_flush_failures_total',
      help: 'Flush attempts that failed, by kind (transient, permanent, unexpected).',
      labelNames: ['kind'],
      registers: [registry],
    }),
    telemetryEventsDeadLettered: new Counter({
      name: 'telemetry_events_dead_lettered_total',
      help: 'Events moved to the DLQ, by reason (invalid_payload, insert_failed).',
      labelNames: ['reason'],
      registers: [registry],
    }),
  };
}
