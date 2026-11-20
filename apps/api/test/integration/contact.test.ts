import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { NOTIFICATION_QUEUE_KEYS } from '../../src/dal/notification-queue.dal.js';
import { createRateLimitDal, rateLimitKey } from '../../src/dal/rate-limit.dal.js';
import type { ContactMessageRow } from '../../src/dao/contact-message.dao.js';
import { createIpHasher } from '../../src/infra/ip-hash.js';
import { createPostgresPool } from '../../src/infra/postgres.js';
import { closeRedis, connectRedis, createRedisClient, type Redis } from '../../src/infra/redis.js';
import type { ContactAccepted } from '../../src/schema/contact-message.schema.js';
import { notificationJobSchema } from '../../src/schema/notification-job.schema.js';
import { createRateLimiterManager } from '../../src/services/rate-limiter.manager.js';
import type { DataResponseBody } from '../../src/views/data.view.js';
import type { ErrorResponseBody } from '../../src/views/error.view.js';
import { counterValue } from '../helpers/metrics.js';
import {
  createTestDependencies,
  UNREACHABLE_POSTGRES_URL,
  UNREACHABLE_REDIS_URL,
  type TestDependencies,
} from '../helpers/test-dependencies.js';

const MESSAGE = { name: 'Ada', email: 'ada@example.com', message: 'Hello from the tests!' };
const VISITOR_IP = '203.0.113.7';

/** POSTs the contact form as if from `ip` (light-my-request sets the socket address). */
function postContact(app: FastifyInstance, ip = VISITOR_IP, payload: object = MESSAGE) {
  return app.inject({ method: 'POST', url: '/api/v1/contact', payload, remoteAddress: ip });
}

function rateLimitHeaders(response: LightMyRequestResponse) {
  return {
    limit: response.headers['x-ratelimit-limit'],
    remaining: response.headers['x-ratelimit-remaining'],
    window: response.headers['x-ratelimit-window'],
    retryAfter: response.headers['retry-after'],
  };
}

describe('POST /api/v1/contact with live Postgres and Redis', () => {
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

  beforeEach(async () => {
    await deps.redis.flushdb(); // Redis DB 1 (tests) only
    await deps.postgres.query('TRUNCATE contact_messages');
  });

  async function storedMessages(): Promise<ContactMessageRow[]> {
    const result = await deps.postgres.query<ContactMessageRow>(
      'SELECT * FROM contact_messages ORDER BY created_at',
    );
    return result.rows;
  }

  it('stores the message as PENDING, queues a job for it and answers 202', async () => {
    const response = await postContact(app);

    expect(response.statusCode).toBe(202);
    const { id, status } = response.json<DataResponseBody<ContactAccepted>>().data;
    expect(status).toBe('PENDING');

    const [row] = await storedMessages();
    expect(row).toMatchObject({ id, ...MESSAGE, status: 'PENDING', attempts: 0, sent_at: null });
    // A keyed hash of the IP, never the IP itself.
    expect(row?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.ip_hash).not.toContain(VISITOR_IP);

    const jobs = await deps.redis.lrange(NOTIFICATION_QUEUE_KEYS.ready, 0, -1);
    expect(jobs.map((job) => notificationJobSchema.parse(JSON.parse(job)))).toEqual([
      expect.objectContaining({ messageId: id, attempt: 1 }),
    ]);
  });

  it('allows 3 messages per sender, then answers 429 with Retry-After', async () => {
    const responses: LightMyRequestResponse[] = [];
    for (let i = 0; i < 4; i++) {
      responses.push(await postContact(app));
    }

    expect(responses.map((response) => response.statusCode)).toEqual([202, 202, 202, 429]);
    expect(responses.map((response) => response.headers['x-ratelimit-remaining'])).toEqual([
      '2',
      '1',
      '0',
      '0',
    ]);
    const blocked = responses[3];
    expect(blocked?.json<ErrorResponseBody>().error.code).toBe('RATE_LIMITED');
    // The first message leaves the 600 s window in (just under) 600 s.
    const retryAfter = Number(blocked?.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(595);
    expect(retryAfter).toBeLessThanOrEqual(600);
    expect(await storedMessages()).toHaveLength(3);
    expect(
      await counterValue(deps.metrics.rateLimitDecisions, {
        limiter: 'contact',
        decision: 'denied',
      }),
    ).toBe(1);
  });

  it('does not record rejected requests: retrying while blocked never extends the lockout', async () => {
    for (let i = 0; i < 10; i++) {
      await postContact(app);
    }

    const key = rateLimitKey('contact', createIpHasher(deps.config.ipHash.secret)(VISITOR_IP));
    expect(await deps.redis.zcard(key)).toBe(3); // the 3 accepted requests, not 10
    // An ephemeral key: it disappears one window after the last accepted request.
    expect(await deps.redis.pttl(key)).toBeGreaterThan(595_000);
  });

  it('keeps a separate window per sender IP', async () => {
    for (let i = 0; i < 3; i++) {
      await postContact(app, '203.0.113.7');
    }

    expect((await postContact(app, '203.0.113.7')).statusCode).toBe(429);
    expect((await postContact(app, '198.51.100.20')).statusCode).toBe(202);
  });

  it('puts the rate-limit headers on a 400 too, and counts invalid requests', async () => {
    const response = await postContact(app, VISITOR_IP, { ...MESSAGE, email: 'not-an-email' });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponseBody>().error.details).toEqual([
      { path: 'email', message: 'must be a valid email address' },
    ]);
    // The limiter runs before validation, so this request used one of the 3 slots.
    expect(rateLimitHeaders(response)).toEqual({
      limit: '3',
      remaining: '2',
      window: '600',
      retryAfter: undefined,
    });
    expect(await storedMessages()).toEqual([]);
  });

  it('admits exactly 3 of 20 simultaneous requests, even across 4 API instances', async () => {
    // Four apps with their own Redis connection, like four API replicas behind a load
    // balancer. Only an atomic check-and-add in Redis keeps the total at 3.
    const connections: Redis[] = [];
    const apps: FastifyInstance[] = [];
    for (let i = 0; i < 4; i++) {
      const redis = createRedisClient(
        { url: deps.config.redis.url, connectionName: `replica-${String(i)}` },
        deps.logger,
        deps.metrics,
      );
      await connectRedis(redis);
      connections.push(redis);
      apps.push(buildApp({ ...deps, redis }));
    }

    try {
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => postContact(apps[i % 4] ?? app)),
      );

      const statuses = responses.map((response) => response.statusCode);
      expect(statuses.filter((status) => status === 202)).toHaveLength(3);
      expect(statuses.filter((status) => status === 429)).toHaveLength(17);
      expect(await storedMessages()).toHaveLength(3);
    } finally {
      await Promise.all(apps.map((replica) => replica.close()));
      await Promise.all(connections.map((redis) => closeRedis(redis)));
    }
  });

  it('slides: each slot frees up exactly one window after its own request', async () => {
    // The manager against real Redis, with a clock the test controls (no 10-minute waits).
    let clock = 1_763_456_000_000;
    const limiter = createRateLimiterManager({
      limiter: 'contact',
      rateLimitDal: createRateLimitDal(deps.redis),
      hashIp: createIpHasher(deps.config.ipHash.secret),
      metrics: deps.metrics,
      max: 3,
      windowSeconds: 600,
      now: () => clock,
    });
    const at = async (offsetMs: number) => {
      clock = 1_763_456_000_000 + offsetMs;
      return limiter.consume(VISITOR_IP, deps.logger);
    };

    await at(0);
    await at(1_000);
    await at(2_000);
    expect(await at(3_000)).toMatchObject({ allowed: false, retryAfterSeconds: 597 });

    // 600 s after the first request, its slot is free again; the other two still count.
    expect(await at(600_000)).toMatchObject({ allowed: true, remaining: 0 });
    // A fixed window would reset everything here. A sliding one waits for the 1 s request.
    expect(await at(600_001)).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect(await at(601_000)).toMatchObject({ allowed: true });
  });

  it('still answers 202 when the job cannot be queued, and counts the failure', async () => {
    // Make LPUSH fail: a string where the job list should be gives a WRONGTYPE error.
    await deps.redis.set(NOTIFICATION_QUEUE_KEYS.ready, 'not a list');

    const response = await postContact(app);

    expect(response.statusCode).toBe(202);
    expect(await storedMessages()).toHaveLength(1); // safe; the reconciler will queue it
    expect(await counterValue(deps.metrics.notificationEnqueueFailures)).toBe(1);
  });

  it('answers 503 when Postgres is down, after the rate limiter has counted the request', async () => {
    const deadPostgres = createPostgresPool(
      { url: UNREACHABLE_POSTGRES_URL, poolMax: 1, applicationName: 'dead-postgres' },
      deps.logger,
      deps.metrics,
    );
    const noDatabase = buildApp({ ...deps, postgres: deadPostgres });

    try {
      const response = await postContact(noDatabase);

      expect(response.statusCode).toBe(503);
      expect(response.json<ErrorResponseBody>().error.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.headers['x-ratelimit-remaining']).toBe('2');
      expect(await deps.redis.llen(NOTIFICATION_QUEUE_KEYS.ready)).toBe(0);
    } finally {
      await noDatabase.close();
      await deadPostgres.end();
    }
  });
});

describe('POST /api/v1/contact with Redis down', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
    await deps.postgres.query('TRUNCATE contact_messages');
  });

  afterAll(async () => {
    await deps.close();
  });

  it('fails closed: 503, nothing stored, rate_limit_errors_total counted', async () => {
    const deadRedis = createRedisClient(
      { url: UNREACHABLE_REDIS_URL, connectionName: 'dead-redis' },
      deps.logger,
      deps.metrics,
    );
    const app = buildApp({ ...deps, redis: deadRedis });

    try {
      const response = await postContact(app);

      expect(response.statusCode).toBe(503);
      expect(response.json<ErrorResponseBody>().error.code).toBe('SERVICE_UNAVAILABLE');
      const rows = await deps.postgres.query('SELECT 1 FROM contact_messages');
      expect(rows.rowCount).toBe(0);
      expect(await counterValue(deps.metrics.rateLimitErrors, { limiter: 'contact' })).toBe(1);
    } finally {
      await app.close();
      await closeRedis(deadRedis);
    }
  });
});
