import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { EventBufferDal } from '../../../src/dal/event-buffer.dal.js';
import type { TelemetrySaltDal } from '../../../src/dal/telemetry-salt.dal.js';
import { AppError } from '../../../src/errors/app-error.js';
import { createMetrics } from '../../../src/infra/metrics.js';
import {
  bufferedEventSchema,
  type EventRequest,
} from '../../../src/schema/analytics-event.schema.js';
import {
  createTelemetryManager,
  hashVisitor,
  hostOf,
  stripQueryAndFragment,
} from '../../../src/services/telemetry.manager.js';
import { counterValue } from '../../helpers/metrics.js';

const log = pino({ level: 'silent' });
const VISITOR = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (test)' };
const PAGE_VIEW: EventRequest = {
  type: 'page_view',
  path: '/projects/x?utm_source=hn#top',
  referrer: 'https://news.ycombinator.com/item?id=1',
  sessionId: 'k3J9xQ2mP0aZ',
};

function setup(options: { capacity?: number; failWith?: Error } = {}) {
  const buffer: string[] = [];
  const saltRequests: string[] = [];
  const bufferDal: EventBufferDal = {
    enqueue: (eventJson, maxLength) => {
      if (options.failWith) return Promise.reject(options.failWith);
      if (buffer.length >= Math.min(maxLength, options.capacity ?? Infinity)) {
        return Promise.resolve(false);
      }
      buffer.push(eventJson);
      return Promise.resolve(true);
    },
  };
  const saltDal: TelemetrySaltDal = {
    getOrCreate: (date) => {
      saltRequests.push(date);
      return Promise.resolve(`salt-for-${date}`);
    },
  };
  let clock = new Date('2026-11-17T10:00:00.000Z');
  const metrics = createMetrics();
  const manager = createTelemetryManager({
    bufferDal,
    saltDal,
    metrics,
    bufferMaxLength: 100,
    now: () => clock,
    newEventId: () => '6f1c2b1e-8a3d-4b5c-9e7f-0a1b2c3d4e5f',
  });
  const setClock = (iso: string) => {
    clock = new Date(iso);
  };
  return { manager, buffer, saltRequests, metrics, setClock };
}

describe('TelemetryManager.ingest', () => {
  it('buffers a normalised, hashed event and returns its id', async () => {
    const { manager, buffer, metrics } = setup();

    const accepted = await manager.ingest(PAGE_VIEW, VISITOR, log);

    expect(accepted).toEqual({ eventId: '6f1c2b1e-8a3d-4b5c-9e7f-0a1b2c3d4e5f' });
    expect(buffer).toHaveLength(1);
    const stored = bufferedEventSchema.parse(JSON.parse(buffer[0] ?? ''));
    expect(stored).toEqual({
      id: '6f1c2b1e-8a3d-4b5c-9e7f-0a1b2c3d4e5f',
      type: 'page_view',
      name: null,
      path: '/projects/x',
      referrerHost: 'news.ycombinator.com',
      sessionId: 'k3J9xQ2mP0aZ',
      visitorHash: hashVisitor('salt-for-2026-11-17', VISITOR),
      receivedAt: '2026-11-17T10:00:00.000Z',
    });
    expect(await counterValue(metrics.telemetryEventsIngested, { type: 'page_view' })).toBe(1);
  });

  it('never stores the raw IP or user agent', async () => {
    const { manager, buffer } = setup();

    await manager.ingest(PAGE_VIEW, VISITOR, log);

    expect(buffer[0]).not.toContain(VISITOR.ip);
    expect(buffer[0]).not.toContain('Mozilla');
  });

  it("asks Redis for the salt once per UTC day, then uses the new day's salt", async () => {
    const { manager, saltRequests, setClock } = setup();

    await manager.ingest(PAGE_VIEW, VISITOR, log);
    await manager.ingest(PAGE_VIEW, VISITOR, log);
    setClock('2026-11-18T00:00:01.000Z');
    await manager.ingest(PAGE_VIEW, VISITOR, log);

    expect(saltRequests).toEqual(['2026-11-17', '2026-11-18']);
  });

  it('answers 503 and counts buffer_full when the buffer is at its cap', async () => {
    const { manager, metrics } = setup({ capacity: 0 });

    const error = await manager.ingest(PAGE_VIEW, VISITOR, log).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    expect(await counterValue(metrics.telemetryEventsRejected, { reason: 'buffer_full' })).toBe(1);
  });

  it('answers 503 and counts redis_unavailable when Redis is down', async () => {
    const down = new Error("Stream isn't writeable and enableOfflineQueue options is false");
    const { manager, metrics } = setup({ failWith: down });

    const error = await manager.ingest(PAGE_VIEW, VISITOR, log).catch((err: unknown) => err);

    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', cause: down });
    expect(
      await counterValue(metrics.telemetryEventsRejected, { reason: 'redis_unavailable' }),
    ).toBe(1);
  });

  it('lets a non-transient error through unchanged (it becomes a 500)', async () => {
    const bug = new TypeError('something is undefined');
    const { manager } = setup({ failWith: bug });

    await expect(manager.ingest(PAGE_VIEW, VISITOR, log)).rejects.toBe(bug);
  });
});

describe('normalisation helpers', () => {
  it('strips query strings and fragments from paths', () => {
    expect(stripQueryAndFragment('/a?b=1#c')).toBe('/a');
    expect(stripQueryAndFragment('/a#c?b')).toBe('/a');
    expect(stripQueryAndFragment('/plain')).toBe('/plain');
  });

  it('keeps only the host of a referrer', () => {
    expect(hostOf('https://www.google.com/search?q=zhu')).toBe('www.google.com');
    expect(hostOf(null)).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });

  it('hashes the same visitor identically, and differently with another salt', () => {
    expect(hashVisitor('s1', VISITOR)).toBe(hashVisitor('s1', VISITOR));
    expect(hashVisitor('s1', VISITOR)).not.toBe(hashVisitor('s2', VISITOR));
    expect(hashVisitor('s1', VISITOR)).toMatch(/^[0-9a-f]{64}$/);
  });
});
