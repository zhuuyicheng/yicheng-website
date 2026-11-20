import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createAnalyticsEventDal } from '../../src/dal/analytics-event.dal.js';
import { createEventBufferDal, TELEMETRY_BUFFER_KEYS } from '../../src/dal/event-buffer.dal.js';
import type { AnalyticsEventRow } from '../../src/dao/analytics-event.dao.js';
import { createPostgresPool, type PostgresPool } from '../../src/infra/postgres.js';
import {
  bufferedEventSchema,
  deadLetteredEventSchema,
} from '../../src/schema/analytics-event.schema.js';
import { createTelemetryDlqManager } from '../../src/services/telemetry-dlq.manager.js';
import { createTelemetryFlushManager } from '../../src/services/telemetry-flush.manager.js';
import { counterValue } from '../helpers/metrics.js';
import { bufferedEventJson } from '../helpers/telemetry-events.js';
import {
  createTestDependencies,
  UNREACHABLE_POSTGRES_URL,
  type TestDependencies,
} from '../helpers/test-dependencies.js';

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

describe('telemetry flusher with live Redis and Postgres', () => {
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
    await deps.postgres.query('TRUNCATE analytics_events');
  });

  function createFlushManager(postgres: PostgresPool = deps.postgres) {
    return createTelemetryFlushManager({
      bufferDal: createEventBufferDal(deps.redis),
      analyticsEventDal: createAnalyticsEventDal(postgres),
      metrics: deps.metrics,
      batchSize: 50,
    });
  }

  async function storedRows(): Promise<AnalyticsEventRow[]> {
    const result = await deps.postgres.query<AnalyticsEventRow>(
      'SELECT * FROM analytics_events ORDER BY received_at, id',
    );
    return result.rows;
  }

  function listLength(key: string): Promise<number> {
    return deps.redis.llen(key);
  }

  it('moves ingested events into analytics_events, with every column filled in', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: {
        type: 'page_view',
        path: '/projects/bowling-buddy?ref=acme',
        referrer: 'https://www.linkedin.com/',
        sessionId: 'k3J9xQ2mP0aZ',
        timezone: 'Asia/Singapore',
      },
      headers: { 'user-agent': CHROME_ON_MAC, 'accept-language': 'en-SG,en;q=0.9' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: {
        type: 'interaction',
        name: 'click:github-link',
        path: '/',
        sessionId: 'k3J9xQ2mP0aZ',
      },
    });

    const outcome = await createFlushManager().flushOnce(deps.logger);

    expect(outcome).toEqual({ claimed: 2, inserted: 2, deadLettered: 0 });
    const [pageView, interaction] = await storedRows();
    expect(pageView).toMatchObject({
      event_type: 'page_view',
      event_name: null,
      path: '/projects/bowling-buddy',
      referrer_host: 'www.linkedin.com',
      ref: 'acme',
      browser: 'Chrome',
      os: 'macOS',
      ip_address: '127.0.0.1', // light-my-request's default client address
      device_type: 'desktop',
      language: 'en-SG',
      timezone: 'Asia/Singapore',
      country_code: null, // the test app has no GeoIP databases
    });
    expect(interaction).toMatchObject({
      event_type: 'interaction',
      event_name: 'click:github-link',
    });
    expect(await listLength(TELEMETRY_BUFFER_KEYS.buffer)).toBe(0);
    expect(await listLength(TELEMETRY_BUFFER_KEYS.inflight)).toBe(0);
  });

  it('after a crash between insert and acknowledge, re-delivers the batch without duplicates', async () => {
    const bufferDal = createEventBufferDal(deps.redis);
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, bufferedEventJson(), bufferedEventJson());
    // A previous worker claimed the batch and inserted it, then died before acknowledging.
    const claimed = await bufferDal.claimBatch(50);
    await createAnalyticsEventDal(deps.postgres).insertBatch(
      claimed.map((entry) => bufferedEventSchema.parse(JSON.parse(entry))),
    );

    const outcome = await createFlushManager().flushOnce(deps.logger);

    expect(outcome).toEqual({ claimed: 2, inserted: 0, deadLettered: 0 });
    expect(await storedRows()).toHaveLength(2);
    expect(await listLength(TELEMETRY_BUFFER_KEYS.inflight)).toBe(0);
  });

  it('dead-letters poison events and still inserts the rest of the batch', async () => {
    const good = bufferedEventJson();
    const notJson = '{oops';
    // Passes the buffer schema, but breaks the table's CHECK (interactions need a name).
    const breaksCheck = bufferedEventJson({ type: 'interaction', name: null });
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, good, notJson, breaksCheck);

    const outcome = await createFlushManager().flushOnce(deps.logger);

    expect(outcome).toEqual({ claimed: 3, inserted: 1, deadLettered: 2 });
    expect(await storedRows()).toHaveLength(1);
    const deadLetters = (await deps.redis.lrange(TELEMETRY_BUFFER_KEYS.deadLetter, 0, -1)).map(
      (text) => deadLetteredEventSchema.parse(JSON.parse(text)),
    );
    expect(deadLetters).toEqual([
      expect.objectContaining({ payload: notJson, reason: 'invalid_payload', errorCode: null }),
      expect.objectContaining({
        payload: breaksCheck,
        reason: 'insert_failed',
        errorCode: '23514',
      }),
    ]);
    expect(await listLength(TELEMETRY_BUFFER_KEYS.inflight)).toBe(0);
  });

  it('keeps the batch in flight while Postgres is down, then delivers it once it is back', async () => {
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, bufferedEventJson());
    const deadPostgres = createPostgresPool(
      { url: UNREACHABLE_POSTGRES_URL, poolMax: 1, applicationName: 'dead-postgres' },
      deps.logger,
      deps.metrics,
    );

    try {
      await expect(createFlushManager(deadPostgres).flushOnce(deps.logger)).rejects.toMatchObject({
        code: 'ECONNREFUSED',
      });
    } finally {
      await deadPostgres.end();
    }
    expect(await listLength(TELEMETRY_BUFFER_KEYS.inflight)).toBe(1); // safe, not lost

    expect(await createFlushManager().flushOnce(deps.logger)).toMatchObject({ inserted: 1 });
    expect(await listLength(TELEMETRY_BUFFER_KEYS.inflight)).toBe(0);
  });

  it('inserts events buffered by the previous version, leaving their details empty', async () => {
    const previousVersionEvent = JSON.stringify({
      id: 'c0dc5e66-638f-42e7-885f-0b392f07b8a6',
      type: 'page_view',
      name: null,
      path: '/projects/bowling-buddy',
      referrerHost: 'www.linkedin.com',
      sessionId: 'demoSession01',
      visitorHash: 'a'.repeat(64),
      receivedAt: '2026-11-17T15:01:47.895Z',
    });
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, previousVersionEvent);

    await createFlushManager().flushOnce(deps.logger);

    expect(await storedRows()).toEqual([
      expect.objectContaining({
        referrer_host: 'www.linkedin.com',
        ref: null,
        browser: null,
        ip_address: null,
      }),
    ]);
  });

  it('replays dead letters into the buffer, where the next flush retries them', async () => {
    const event = bufferedEventJson();
    await deps.redis.rpush(
      TELEMETRY_BUFFER_KEYS.deadLetter,
      JSON.stringify({
        payload: event,
        reason: 'insert_failed',
        errorCode: '42P01', // e.g. the worker ran before the migration; since fixed
        errorMessage: 'relation "analytics_events" does not exist',
        failedAt: new Date().toISOString(),
      }),
    );
    const before = await counterValue(deps.metrics.telemetryEventsFlushed);

    const replay = await createTelemetryDlqManager({
      bufferDal: createEventBufferDal(deps.redis),
    }).replay(deps.logger);
    await createFlushManager().flushOnce(deps.logger);

    expect(replay).toEqual({ replayed: 1, unreadable: 0 });
    expect(await listLength(TELEMETRY_BUFFER_KEYS.deadLetter)).toBe(0);
    expect(await storedRows()).toHaveLength(1);
    expect((await counterValue(deps.metrics.telemetryEventsFlushed)) - before).toBe(1);
  });
});
