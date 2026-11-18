import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { TELEMETRY_BUFFER_KEYS } from '../../src/dal/event-buffer.dal.js';
import { telemetrySaltKey } from '../../src/dal/telemetry-salt.dal.js';
import { openIpDatabases } from '../../src/infra/ip-databases.js';
import { closeRedis, createRedisClient } from '../../src/infra/redis.js';
import {
  bufferedEventSchema,
  type BufferedEvent,
  type EventAccepted,
} from '../../src/schema/analytics-event.schema.js';
import type { DataResponseBody } from '../../src/views/data.view.js';
import type { ErrorResponseBody } from '../../src/views/error.view.js';
import { GEOIP_FIXTURES } from '../helpers/geoip-fixtures.js';
import { counterValue } from '../helpers/metrics.js';
import {
  createTestDependencies,
  UNREACHABLE_REDIS_URL,
  type TestDependencies,
} from '../helpers/test-dependencies.js';

const FIREFOX_ON_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';

const PAGE_VIEW = {
  type: 'page_view',
  path: '/projects/bowling-buddy?utm_source=linkedin',
  referrer: 'https://www.linkedin.com/feed/',
  sessionId: 'k3J9xQ2mP0aZ',
};

describe('POST /api/v1/events with live Redis', () => {
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
  });

  async function bufferedEvents(): Promise<BufferedEvent[]> {
    const items = await deps.redis.lrange(TELEMETRY_BUFFER_KEYS.buffer, 0, -1);
    return items.map((item) => bufferedEventSchema.parse(JSON.parse(item)));
  }

  function postEvent(target: FastifyInstance, headers: Record<string, string> = {}) {
    return target.inject({ method: 'POST', url: '/api/v1/events', payload: PAGE_VIEW, headers });
  }

  it('answers 202 and appends one normalised event to the Redis buffer', async () => {
    const response = await postEvent(app);

    expect(response.statusCode).toBe(202);
    const { eventId } = response.json<DataResponseBody<EventAccepted>>().data;
    const [event] = await bufferedEvents();
    expect(event).toMatchObject({
      id: eventId,
      type: 'page_view',
      path: '/projects/bowling-buddy',
      referrerHost: 'www.linkedin.com',
    });
    expect(await counterValue(deps.metrics.telemetryEventsIngested, { type: 'page_view' })).toBe(1);
  });

  it('creates the daily salt once, with a 48 h TTL, and hashes a visitor consistently', async () => {
    // A fresh app: the shared one already holds today's salt in memory from earlier tests
    // (by design it asks Redis once per day), so it would not recreate the flushed key.
    const freshApp = buildApp(deps);

    try {
      await postEvent(freshApp);
      await postEvent(freshApp);

      const today = new Date().toISOString().slice(0, 10);
      const ttl = await deps.redis.ttl(telemetrySaltKey(today));
      expect(ttl).toBeGreaterThan(47 * 3600);
      expect(ttl).toBeLessThanOrEqual(48 * 3600);
      const [first, second] = await bufferedEvents();
      expect(first?.visitorHash).toBe(second?.visitorHash);
    } finally {
      await freshApp.close();
    }
  });

  it('rejects an invalid event with 400 and field details, buffering nothing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: { ...PAGE_VIEW, type: 'interaction' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponseBody>().error.details).toEqual([
      { path: 'name', message: 'is required for interactions' },
    ]);
    expect(await bufferedEvents()).toEqual([]);
  });

  it('answers 503 once the buffer holds TELEMETRY_BUFFER_MAX_LENGTH events', async () => {
    const tinyBuffer = buildApp({
      ...deps,
      config: { ...deps.config, telemetry: { ...deps.config.telemetry, bufferMaxLength: 2 } },
    });

    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await postEvent(tinyBuffer)).statusCode);
      }

      expect(statuses).toEqual([202, 202, 503]);
      expect(await deps.redis.llen(TELEMETRY_BUFFER_KEYS.buffer)).toBe(2);
      expect(
        await counterValue(deps.metrics.telemetryEventsRejected, { reason: 'buffer_full' }),
      ).toBe(1);
    } finally {
      await tinyBuffer.close();
    }
  });

  it('only trusts X-Forwarded-For when TRUST_PROXY is on', async () => {
    const behindProxy = buildApp({
      ...deps,
      config: { ...deps.config, server: { ...deps.config.server, trustProxy: true } },
    });

    try {
      // Without a trusted proxy, a client cannot pretend to be someone else.
      await postEvent(app, { 'x-forwarded-for': '198.51.100.1' });
      await postEvent(app, { 'x-forwarded-for': '198.51.100.2' });
      // Behind a trusted proxy, the header identifies the real visitor.
      await postEvent(behindProxy, { 'x-forwarded-for': '198.51.100.1' });
      await postEvent(behindProxy, { 'x-forwarded-for': '198.51.100.2' });

      const hashes = (await bufferedEvents()).map((event) => event.visitorHash);
      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[2]).not.toBe(hashes[3]);
    } finally {
      await behindProxy.close();
    }
  });

  it('records visitor details from the link, the browser and the IP address', async () => {
    const withGeoIp = buildApp({
      ...deps,
      config: { ...deps.config, server: { ...deps.config.server, trustProxy: true } },
      ipDatabases: await openIpDatabases(GEOIP_FIXTURES, deps.logger),
    });

    try {
      const response = await withGeoIp.inject({
        method: 'POST',
        url: '/api/v1/events',
        payload: {
          ...PAGE_VIEW,
          path: '/?ref=acme&utm_source=email',
          timezone: 'Europe/Stockholm',
        },
        headers: {
          'user-agent': FIREFOX_ON_LINUX,
          'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
          'x-forwarded-for': '89.160.20.115', // in both MaxMind test databases
        },
      });

      expect(response.statusCode).toBe(202);
      const [event] = await bufferedEvents();
      expect(event).toMatchObject({
        path: '/',
        campaign: { ref: 'acme', utmSource: 'email', utmMedium: null, utmCampaign: null },
        device: {
          browser: 'Firefox',
          os: 'Linux',
          type: 'desktop',
          language: 'sv-SE',
          timezone: 'Europe/Stockholm',
        },
        network: { countryCode: 'SE', city: 'Linköping', organization: 'Bredband2 AB' },
      });
    } finally {
      await withGeoIp.close();
    }
  });

  it('keeps working after Redis forgets the Lua script (EVALSHA → NOSCRIPT → EVAL)', async () => {
    // SCRIPT FLUSH clears cached scripts only, not data; it is what a Redis restart does.
    await deps.redis.script('FLUSH');

    expect((await postEvent(app)).statusCode).toBe(202);
  });
});

describe('POST /api/v1/events with Redis down', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  it('answers 503 and counts redis_unavailable (no in-memory fallback)', async () => {
    const deadRedis = createRedisClient(
      { url: UNREACHABLE_REDIS_URL, connectionName: 'dead-redis' },
      deps.logger,
      deps.metrics,
    );
    const app = buildApp({ ...deps, redis: deadRedis });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        payload: PAGE_VIEW,
      });

      expect(response.statusCode).toBe(503);
      expect(response.json<ErrorResponseBody>().error.code).toBe('SERVICE_UNAVAILABLE');
      expect(
        await counterValue(deps.metrics.telemetryEventsRejected, { reason: 'redis_unavailable' }),
      ).toBe(1);
    } finally {
      await app.close();
      await closeRedis(deadRedis);
    }
  });
});
