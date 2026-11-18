import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { AnalyticsEventDal } from '../../../src/dal/analytics-event.dal.js';
import { createMetrics } from '../../../src/infra/metrics.js';
import {
  deadLetteredEventSchema,
  type BufferedEvent,
} from '../../../src/schema/analytics-event.schema.js';
import { createTelemetryFlushManager } from '../../../src/services/telemetry-flush.manager.js';
import { counterValue } from '../../helpers/metrics.js';

const log = pino({ level: 'silent' });

/** A valid buffer entry (JSON text, as the API writes it). */
function entry(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    type: 'page_view',
    name: null,
    path: '/',
    referrerHost: null,
    sessionId: 'k3J9xQ2mP0aZ',
    visitorHash: 'a'.repeat(64),
    receivedAt: '2026-11-17T10:00:00.000Z',
    ...overrides,
  });
}

const ID = {
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  c: '00000000-0000-4000-8000-00000000000c',
};

/** What Postgres throws, in the shapes the classifier recognises. */
const OUTAGE = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
  code: 'ECONNREFUSED',
});
const checkViolation = () =>
  Object.assign(new Error('new row violates check constraint'), { code: '23514' });

interface FakeOptions {
  claim: string[];
  /** Ids already in Postgres (a re-claimed batch after a crash). */
  stored?: string[];
  /** Ids whose row Postgres rejects for its data. */
  poison?: string[];
  /** Fail every insert as if Postgres were down, starting with insert number `outageFrom`. */
  outageFrom?: number;
}

function setup(options: FakeOptions) {
  const stored = new Set(options.stored ?? []);
  const insertCalls: BufferedEvent[][] = [];
  const acknowledged: string[][] = [];

  const analyticsEventDal: AnalyticsEventDal = {
    insertBatch: (events) => {
      insertCalls.push([...events]);
      if (options.outageFrom !== undefined && insertCalls.length >= options.outageFrom) {
        return Promise.reject(OUTAGE);
      }
      if (events.some((event) => options.poison?.includes(event.id))) {
        return Promise.reject(checkViolation()); // one bad row fails the whole statement
      }
      const fresh = events.filter((event) => !stored.has(event.id));
      fresh.forEach((event) => stored.add(event.id));
      return Promise.resolve(fresh.length);
    },
  };
  const metrics = createMetrics();
  const manager = createTelemetryFlushManager({
    bufferDal: {
      claimBatch: () => Promise.resolve(options.claim),
      acknowledge: (deadLetters) => {
        acknowledged.push([...deadLetters]);
        return Promise.resolve();
      },
    },
    analyticsEventDal,
    metrics,
    batchSize: 50,
    now: () => new Date('2026-11-17T12:00:00.000Z'),
  });
  return { manager, metrics, stored, insertCalls, acknowledged };
}

function deadLettersOf(acknowledged: string[][]) {
  return (acknowledged[0] ?? []).map((text) => deadLetteredEventSchema.parse(JSON.parse(text)));
}

describe('TelemetryFlushManager.flushOnce', () => {
  it('does nothing when the buffer is empty', async () => {
    const { manager, insertCalls, acknowledged } = setup({ claim: [] });

    expect(await manager.flushOnce(log)).toEqual({ claimed: 0, inserted: 0, deadLettered: 0 });
    expect(insertCalls).toEqual([]);
    expect(acknowledged).toEqual([]);
  });

  it('inserts the whole batch with one call, then acknowledges it', async () => {
    const { manager, metrics, insertCalls, acknowledged } = setup({
      claim: [entry(ID.a), entry(ID.b)],
    });

    expect(await manager.flushOnce(log)).toEqual({ claimed: 2, inserted: 2, deadLettered: 0 });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.map((event) => event.id)).toEqual([ID.a, ID.b]);
    expect(acknowledged).toEqual([[]]);
    expect(await counterValue(metrics.telemetryEventsFlushed)).toBe(2);
  });

  it('counts only new rows when a re-claimed batch is partly in Postgres already', async () => {
    const { manager, metrics } = setup({ claim: [entry(ID.a), entry(ID.b)], stored: [ID.a] });

    expect(await manager.flushOnce(log)).toEqual({ claimed: 2, inserted: 1, deadLettered: 0 });
    expect(await counterValue(metrics.telemetryEventsFlushed)).toBe(1);
  });

  it('dead-letters entries that are not valid events, and inserts the rest', async () => {
    const notJson = '{oops';
    const notAnEvent = entry(ID.b, { type: 'purchase' });
    const { manager, metrics, insertCalls, acknowledged } = setup({
      claim: [entry(ID.a), notJson, notAnEvent],
    });

    expect(await manager.flushOnce(log)).toEqual({ claimed: 3, inserted: 1, deadLettered: 2 });
    expect(insertCalls[0]?.map((event) => event.id)).toEqual([ID.a]);
    const [first, second] = deadLettersOf(acknowledged);
    expect(first).toEqual({
      payload: notJson,
      reason: 'invalid_payload',
      errorCode: null,
      errorMessage: 'not valid JSON',
      failedAt: '2026-11-17T12:00:00.000Z',
    });
    expect(second).toMatchObject({ payload: notAnEvent, reason: 'invalid_payload' });
    expect(second?.errorMessage).toMatch(/^type:/); // which field was wrong
    expect(
      await counterValue(metrics.telemetryEventsDeadLettered, { reason: 'invalid_payload' }),
    ).toBe(2);
  });

  it('finds a poison row by retrying one at a time, and dead-letters only that row', async () => {
    const { manager, metrics, stored, acknowledged } = setup({
      claim: [entry(ID.a), entry(ID.b), entry(ID.c)],
      poison: [ID.b],
    });

    expect(await manager.flushOnce(log)).toEqual({ claimed: 3, inserted: 2, deadLettered: 1 });
    expect([...stored]).toEqual([ID.a, ID.c]);
    expect(deadLettersOf(acknowledged)).toEqual([
      expect.objectContaining({
        payload: entry(ID.b),
        reason: 'insert_failed',
        errorCode: '23514',
      }),
    ]);
    expect(await counterValue(metrics.telemetryFlushFailures, { kind: 'permanent' })).toBe(1);
    expect(
      await counterValue(metrics.telemetryEventsDeadLettered, { reason: 'insert_failed' }),
    ).toBe(1);
  });

  it('throws on an outage WITHOUT acknowledging, so the batch stays in flight', async () => {
    const { manager, acknowledged } = setup({ claim: [entry(ID.a)], outageFrom: 1 });

    await expect(manager.flushOnce(log)).rejects.toBe(OUTAGE);
    expect(acknowledged).toEqual([]);
  });

  it('counts dead letters only once they are stored, not on a flush that is retried', async () => {
    const { manager, metrics } = setup({ claim: ['{oops', entry(ID.a)], outageFrom: 1 });

    await expect(manager.flushOnce(log)).rejects.toBe(OUTAGE);

    // The retry will reject '{oops' again; counting it now as well would count it twice.
    expect(await counterValue(metrics.telemetryEventsDeadLettered)).toBe(0);
  });

  it('stops retrying row by row as soon as Postgres goes down', async () => {
    const { manager, insertCalls, acknowledged } = setup({
      claim: [entry(ID.a), entry(ID.b)],
      poison: [ID.b],
      outageFrom: 2, // the batch fails for its data, then the first single-row insert hits an outage
    });

    await expect(manager.flushOnce(log)).rejects.toBe(OUTAGE);
    expect(insertCalls).toHaveLength(2);
    expect(acknowledged).toEqual([]);
  });
});
