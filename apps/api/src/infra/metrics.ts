import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Every Prometheus metric (DESIGN.md §8.5), on one registry. Passed down, not global, so each
 * test gets fresh counters.
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
  rateLimitDecisions: Counter<'limiter' | 'decision'>;
  rateLimitErrors: Counter<'limiter'>;
  notificationEnqueueFailures: Counter;
  notificationJobs: Counter<'outcome'>;
  notificationJobsRequeued: Counter<'reason'>;
  workerLoopFailures: Counter<'loop' | 'kind'>;
  httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;
  httpRequests: Counter<'method' | 'route' | 'status_code'>;
  queueDepth: Gauge<'queue'>;
  observabilityReadErrors: Counter<'source'>;
}

/** What the status report or /metrics couldn't read (the rest is still served). */
export type ObservabilitySource = 'queue_depths' | 'page_views';

/** Why POST /api/v1/events refused an event (always a 503). */
export type TelemetryRejectReason = 'buffer_full' | 'redis_unavailable';

/**
 * Why a flush failed (DESIGN.md §8.2). `transient`: a datastore was down, retried later.
 * `permanent`: Postgres refused the data, bad rows dead-lettered. `unexpected`: a bug.
 */
export type TelemetryFlushFailureKind = 'transient' | 'permanent' | 'unexpected';

/** What a rate limiter decided for one request. */
export type RateLimitDecision = 'allowed' | 'denied';

/** How the worker finished one notification job (DESIGN.md §8.3). */
export type NotificationJobOutcome = 'sent' | 'retried' | 'dead_lettered' | 'skipped';

/**
 * Why a job went back to the ready list: `stranded` (left in `processing` by a crash) or
 * `reconciled` (its message was PENDING with no job).
 */
export type NotificationRequeueReason = 'stranded' | 'reconciled';

export interface MetricsOptions {
  /** CPU, memory, event-loop lag… only worth it in a real process. */
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
    rateLimitDecisions: new Counter({
      name: 'rate_limit_decisions_total',
      help: 'Rate-limit checks, by limiter and decision (allowed, denied).',
      labelNames: ['limiter', 'decision'],
      registers: [registry],
    }),
    rateLimitErrors: new Counter({
      name: 'rate_limit_errors_total',
      help: 'Rate-limit checks that failed because Redis was unavailable (answered 503).',
      labelNames: ['limiter'],
      registers: [registry],
    }),
    notificationEnqueueFailures: new Counter({
      name: 'notification_enqueue_failures_total',
      help: 'Contact messages saved but not queued for notification (the reconciler retries).',
      registers: [registry],
    }),
    notificationJobs: new Counter({
      name: 'notification_jobs_total',
      help: 'Notification jobs finished, by outcome (sent, retried, dead_lettered, skipped).',
      labelNames: ['outcome'],
      registers: [registry],
    }),
    notificationJobsRequeued: new Counter({
      name: 'notification_jobs_requeued_total',
      help: 'Jobs put back in the ready list, by reason (stranded, reconciled).',
      labelNames: ['reason'],
      registers: [registry],
    }),
    workerLoopFailures: new Counter({
      name: 'worker_loop_failures_total',
      help: 'Failed iterations of a worker loop, by loop and kind (transient, unexpected).',
      labelNames: ['loop', 'kind'],
      registers: [registry],
    }),
    httpRequestDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration, by method, route template and status code.',
      labelNames: ['method', 'route', 'status_code'],
      // From "served from memory" (1 ms) to "something's wrong" (5 s). Prometheus estimates a
      // percentile inside its bucket, so fast sites need small ones (DESIGN.md §15.2).
      buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    httpRequests: new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests answered, by method, route template and status code.',
      labelNames: ['method', 'route', 'status_code'],
      registers: [registry],
    }),
    // One gauge with a `queue` label, refreshed on each read: a reset then removes every sample
    // (a label-less gauge would still report 0).
    queueDepth: new Gauge({
      name: 'queue_depth',
      help: 'Items waiting per Redis queue (telemetry_buffer, telemetry_dlq, notifications_*).',
      labelNames: ['queue'],
      registers: [registry],
    }),
    observabilityReadErrors: new Counter({
      name: 'observability_read_errors_total',
      help: 'Status/metrics reads that failed and were left out, by source.',
      labelNames: ['source'],
      registers: [registry],
    }),
  };
}
