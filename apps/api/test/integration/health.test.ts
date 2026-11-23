import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createPostgresPool } from '../../src/infra/postgres.js';
import { closeRedis, createRedisClient } from '../../src/infra/redis.js';
import type { HealthReport, LivenessReport } from '../../src/schema/health.schema.js';
import type { ErrorResponseBody } from '../../src/views/error.view.js';
import {
  createTestDependencies,
  UNREACHABLE_POSTGRES_URL,
  UNREACHABLE_REDIS_URL,
  type TestDependencies,
} from '../helpers/test-dependencies.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('GET /health with live Postgres and Redis', () => {
  let deps: TestDependencies;
  let app: FastifyInstance;

  beforeAll(async () => {
    deps = await createTestDependencies();
    app = buildApp(deps);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await deps.close();
  });

  it('returns 200 with both dependencies up', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const report = response.json<HealthReport>();
    expect(report.status).toBe('ok');
    expect(report.checks.postgres?.status).toBe('up');
    expect(report.checks.redis?.status).toBe('up');
    expect(report.checks.postgres?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('GET /health/live returns 200 {"status":"ok"}', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json<LivenessReport>()).toEqual({ status: 'ok' });
  });

  it('echoes a safe incoming x-request-id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'edge-proxy:abc-123' },
    });

    expect(response.headers['x-request-id']).toBe('edge-proxy:abc-123');
  });

  it('replaces an unsafe x-request-id with a generated UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': '<script>alert(1)</script>' },
    });

    expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('returns the error envelope with the request id for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    const body = response.json<ErrorResponseBody>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
  });
});

describe('GET /health with an unreachable dependency', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  it('returns 503 when Redis is unreachable', async () => {
    const deadRedis = createRedisClient(
      { url: UNREACHABLE_REDIS_URL, connectionName: 'dead-redis' },
      deps.logger,
      deps.metrics,
    );
    const app = buildApp({ ...deps, redis: deadRedis });

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
      const report = response.json<HealthReport>();
      expect(report.status).toBe('degraded');
      expect(report.checks.redis?.status).toBe('down');
      expect(report.checks.postgres?.status).toBe('up');
    } finally {
      await app.close();
      await closeRedis(deadRedis);
    }
  });

  // Why /health/live exists (DESIGN.md §14.5): a shared outage mustn't drop every replica.
  it('GET /health/live still returns 200 with Postgres and Redis both unreachable', async () => {
    const deadRedis = createRedisClient(
      { url: UNREACHABLE_REDIS_URL, connectionName: 'dead-redis' },
      deps.logger,
      deps.metrics,
    );
    const deadPostgres = createPostgresPool(
      { url: UNREACHABLE_POSTGRES_URL, poolMax: 1, applicationName: 'dead-postgres' },
      deps.logger,
      deps.metrics,
    );
    const app = buildApp({ ...deps, redis: deadRedis, postgres: deadPostgres });

    try {
      const live = await app.inject({ method: 'GET', url: '/health/live' });
      const ready = await app.inject({ method: 'GET', url: '/health' });

      expect(live.statusCode).toBe(200);
      expect(live.json<LivenessReport>()).toEqual({ status: 'ok' });
      expect(ready.statusCode).toBe(503); // readiness still tells the truth
    } finally {
      await app.close();
      await closeRedis(deadRedis);
      await deadPostgres.end();
    }
  });

  it('returns 503 when Postgres is unreachable', async () => {
    const deadPostgres = createPostgresPool(
      { url: UNREACHABLE_POSTGRES_URL, poolMax: 1, applicationName: 'dead-postgres' },
      deps.logger,
      deps.metrics,
    );
    const app = buildApp({ ...deps, postgres: deadPostgres });

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
      const report = response.json<HealthReport>();
      expect(report.checks.postgres?.status).toBe('down');
      expect(report.checks.redis?.status).toBe('up');
    } finally {
      await app.close();
      await deadPostgres.end();
    }
  });
});

describe('request logs for the health checks', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  it('logs no info lines for /health and /health/live, unlike visitor requests', async () => {
    const lines: { msg?: string; req?: { url?: string } }[] = [];
    const logger = pino(
      { level: 'info' },
      {
        write: (line: string) => {
          lines.push(JSON.parse(line) as (typeof lines)[number]);
        },
      },
    );
    const app = buildApp({ ...deps, logger });

    try {
      await app.inject({ method: 'GET', url: '/health/live' });
      await app.inject({ method: 'GET', url: '/health' });
      await app.inject({ method: 'GET', url: '/api/v1/projects' }); // shows the capture works

      const incoming = lines.filter((line) => line.msg === 'incoming request');
      expect(incoming.map((line) => line.req?.url)).toEqual(['/api/v1/projects']);
    } finally {
      await app.close();
    }
  });
});
