import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createAnalyticsEventDal } from '../../src/dal/analytics-event.dal.js';
import { TELEMETRY_BUFFER_KEYS } from '../../src/dal/event-buffer.dal.js';
import { createMetrics } from '../../src/infra/metrics.js';
import { closeRedis, createRedisClient } from '../../src/infra/redis.js';
import { bufferedEventSchema } from '../../src/schema/analytics-event.schema.js';
import type { SystemStatus } from '../../src/schema/system-status.schema.js';
import type { DataResponseBody } from '../../src/views/data.view.js';
import type { ErrorResponseBody } from '../../src/views/error.view.js';
import { bufferedEventJson } from '../helpers/telemetry-events.js';
import {
  createTestDependencies,
  UNREACHABLE_REDIS_URL,
  type TestDependencies,
} from '../helpers/test-dependencies.js';

const WEB_APP = 'http://localhost:3000'; // the default CORS_ORIGINS

describe('observability and security with live Postgres and Redis', () => {
  let deps: TestDependencies;
  let app: FastifyInstance;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  beforeEach(async () => {
    await deps.redis.flushdb(); // Redis DB 1 (tests) only
    await deps.postgres.query('TRUNCATE analytics_events');
    // Fresh metrics and app per test: counters, latency window and status cache start empty.
    app = buildApp({ ...deps, metrics: createMetrics() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function getStatus(target = app): Promise<SystemStatus> {
    const response = await target.inject({ method: 'GET', url: '/api/v1/system/status' });
    expect(response.statusCode).toBe(200);
    return response.json<DataResponseBody<SystemStatus>>().data;
  }

  it('GET /api/v1/system/status reports health, traffic, page views and queues', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/projects' });
    await app.inject({ method: 'GET', url: '/api/v1/projects' }); // a cache hit
    await app.inject({ method: 'GET', url: '/does-not-exist' });
    const pageView = bufferedEventSchema.parse(JSON.parse(bufferedEventJson()));
    await createAnalyticsEventDal(deps.postgres).insertBatch([pageView]);
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, bufferedEventJson(), bufferedEventJson());

    const status = await getStatus();

    expect(status.dependencies).toEqual({
      postgres: { status: 'up', latencyMs: expect.any(Number) as unknown },
      redis: { status: 'up', latencyMs: expect.any(Number) as unknown },
    });
    // The 3 requests above; the status request itself is not counted (monitors don't count).
    expect(status.http.requestCount).toBe(3);
    expect(status.http.latencyMs.p95).toBeGreaterThan(0);
    expect(status.cache.hits).toBeGreaterThanOrEqual(1);
    expect(status.analytics.pageViewsLast24h).toBe(1);
    expect(status.queues).toEqual({
      telemetryBuffer: 2,
      telemetryDeadLetter: 0,
      notificationsReady: 0,
      notificationsDelayed: 0,
      notificationsDeadLetter: 0,
    });
    expect(status.instance).not.toBe('');
  });

  it('serves the same status for 5 s (one refresh, however many viewers)', async () => {
    const first = await getStatus();
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, bufferedEventJson());

    const second = await getStatus();

    expect(second.generatedAt).toBe(first.generatedAt);
    expect(second.queues?.telemetryBuffer).toBe(0); // still the cached numbers
  });

  it('GET /metrics: Prometheus text with route templates, never raw URLs', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/projects/no-such-project' });
    await app.inject({ method: 'GET', url: '/wp-admin/install.php' }); // a bot, guessing
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, bufferedEventJson());

    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(response.body).toContain(
      'http_requests_total{method="GET",route="/api/v1/projects/:slug",status_code="404"} 1',
    );
    expect(response.body).toContain(
      'http_requests_total{method="GET",route="unmatched",status_code="404"} 1',
    );
    expect(response.body).not.toContain('no-such-project');
    expect(response.body).not.toContain('wp-admin');
    expect(response.body).toContain('queue_depth{queue="telemetry_buffer"} 1');
    expect(response.body).toContain('http_request_duration_seconds_bucket{le="0.005"');
  });

  it('GET /metrics needs the bearer token once METRICS_TOKEN is set; the status page stays public', async () => {
    const token = 'integration-metrics-token-0123';
    const guarded = buildApp({ ...deps, config: { ...deps.config, metrics: { token } } });

    try {
      const missing = await guarded.inject({ method: 'GET', url: '/metrics' });
      const wrong = await guarded.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer not-the-token' },
      });
      const right = await guarded.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(missing.statusCode).toBe(401);
      expect(missing.headers['www-authenticate']).toBe('Bearer');
      expect(missing.json<ErrorResponseBody>().error.code).toBe('UNAUTHORIZED');
      expect(wrong.statusCode).toBe(401);
      expect(right.statusCode).toBe(200);
      expect(
        (await guarded.inject({ method: 'GET', url: '/api/v1/system/status' })).statusCode,
      ).toBe(200);
    } finally {
      await guarded.close();
    }
  });

  it('adds Helmet security headers to responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('CORS: answers the web app’s preflight, without touching the rate limiter', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/contact',
      headers: {
        origin: WEB_APP,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(WEB_APP);
    expect(preflight.headers['access-control-allow-headers']).toContain('content-type');
    expect(preflight.headers['access-control-max-age']).toBe('600');
    expect(preflight.headers['x-ratelimit-remaining']).toBeUndefined();
    expect(await deps.redis.keys('ratelimit:*')).toEqual([]);
  });

  it('CORS: lets the web app read the rate-limit headers; other sites get no permission', async () => {
    const payload = { name: 'Ada', email: 'ada@example.com', message: 'Hi' };
    const fromWebApp = await app.inject({
      method: 'POST',
      url: '/api/v1/contact',
      payload,
      headers: { origin: WEB_APP },
    });
    const fromElsewhere = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { origin: 'https://evil.example' },
    });

    expect(fromWebApp.headers['access-control-allow-origin']).toBe(WEB_APP);
    expect(fromWebApp.headers['access-control-expose-headers']).toContain('x-ratelimit-remaining');
    expect(fromElsewhere.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('system status with Redis down', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  it('still answers 200: Redis "down", queues unknown (null), Postgres numbers still there', async () => {
    const deadRedis = createRedisClient(
      { url: UNREACHABLE_REDIS_URL, connectionName: 'dead-redis' },
      deps.logger,
      deps.metrics,
    );
    const app = buildApp({ ...deps, redis: deadRedis });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/system/status' });

      expect(response.statusCode).toBe(200);
      const status = response.json<DataResponseBody<SystemStatus>>().data;
      expect(status.dependencies.redis?.status).toBe('down');
      expect(status.dependencies.postgres?.status).toBe('up');
      expect(status.queues).toBeNull();
      expect(status.analytics.pageViewsLast24h).toEqual(expect.any(Number));
    } finally {
      await app.close();
      await closeRedis(deadRedis);
    }
  });
});
