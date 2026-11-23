import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../src/infra/metrics.js';
import { buildWorkerApp } from '../../src/worker-app.js';

const TOKEN = 'unit-test-metrics-token-0123';
const silent = pino({ level: 'silent' });

/** A logger at the default level that keeps every JSON line it writes. */
function capturingLogger() {
  const lines: string[] = [];
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        lines.push(line);
      },
    },
  );
  return { logger, lines };
}

describe('buildWorkerApp', () => {
  it("serves the worker's counters on GET /metrics, in Prometheus's text format", async () => {
    const metrics = createMetrics();
    metrics.telemetryEventsFlushed.inc(3);
    metrics.notificationJobs.inc({ outcome: 'sent' });
    const app = buildWorkerApp({ config: { metrics: { token: null } }, logger: silent, metrics });

    try {
      const response = await app.inject({ method: 'GET', url: '/metrics' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
      expect(response.body).toContain('telemetry_events_flushed_total 3');
      expect(response.body).toContain('notification_jobs_total{outcome="sent"} 1');
    } finally {
      await app.close();
    }
  });

  it('needs the bearer token once METRICS_TOKEN is set, and serves nothing else', async () => {
    const app = buildWorkerApp({
      config: { metrics: { token: TOKEN } },
      logger: silent,
      metrics: createMetrics(),
    });
    const authorization = `Bearer ${TOKEN}`;

    try {
      const missing = await app.inject({ method: 'GET', url: '/metrics' });
      const right = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization },
      });
      const health = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { authorization },
      });

      expect(missing.statusCode).toBe(401);
      expect(right.statusCode).toBe(200);
      expect(health.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('logs nothing for a scrape: Prometheus reads it every 15 s', async () => {
    const { logger, lines } = capturingLogger();
    const app = buildWorkerApp({
      config: { metrics: { token: null } },
      logger,
      metrics: createMetrics(),
    });

    try {
      await app.inject({ method: 'GET', url: '/metrics' });
      await app.inject({ method: 'GET', url: '/elsewhere' }); // logged, so the capture works

      expect(lines.filter((line) => line.includes('"/metrics"'))).toEqual([]);
      expect(lines.some((line) => line.includes('"/elsewhere"'))).toBe(true);
    } finally {
      await app.close();
    }
  });
});
