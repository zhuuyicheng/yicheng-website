import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createTelemetryDlqManager } from '../../../src/services/telemetry-dlq.manager.js';

const log = pino({ level: 'silent' });

function deadLetter(payload: string): string {
  return JSON.stringify({
    payload,
    reason: 'insert_failed',
    errorCode: '42P01',
    errorMessage: 'relation "analytics_events" does not exist',
    failedAt: '2026-11-17T12:00:00.000Z',
  });
}

describe('TelemetryDlqManager.replay', () => {
  it('puts each original payload back in the buffer and leaves unreadable entries alone', async () => {
    const dlq = [deadLetter('{"id":"a"}'), 'garbage', deadLetter('{"id":"b"}')];
    const buffer: string[] = [];
    const manager = createTelemetryDlqManager({
      bufferDal: {
        listDeadLetters: () => Promise.resolve([...dlq]),
        replayDeadLetter: (entry, payload) => {
          buffer.push(payload);
          dlq.splice(dlq.indexOf(entry), 1);
          return Promise.resolve();
        },
      },
    });

    expect(await manager.replay(log)).toEqual({ replayed: 2, unreadable: 1 });
    expect(buffer).toEqual(['{"id":"a"}', '{"id":"b"}']);
    expect(dlq).toEqual(['garbage']);
  });
});
