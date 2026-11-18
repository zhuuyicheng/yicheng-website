import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TELEMETRY_BUFFER_KEYS } from '../../src/dal/event-buffer.dal.js';
import { bufferedEventJson } from '../helpers/telemetry-events.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';
import { integrationTestEnv } from './test-env.js';

const API_ROOT = path.resolve(import.meta.dirname, '../..');

/** Runs the real `dlq:replay` CLI against the test Redis DB. */
function runReplayCli(...args: string[]): Promise<number | null> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/replay-dlq.ts', ...args], {
    cwd: API_ROOT,
    env: { ...process.env, ...integrationTestEnv },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return new Promise((resolve) => {
    child.once('exit', resolve);
  });
}

function deadLetter(payload: string): string {
  return JSON.stringify({
    payload,
    reason: 'insert_failed',
    errorCode: '42P01',
    errorMessage: 'relation "analytics_events" does not exist',
    failedAt: new Date().toISOString(),
  });
}

describe('dlq:replay CLI', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  beforeEach(async () => {
    await deps.redis.flushdb(); // Redis DB 1 (tests) only
  });

  it('moves every dead-lettered event back into the buffer and exits 0', async () => {
    const events = [bufferedEventJson(), bufferedEventJson()];
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.deadLetter, ...events.map(deadLetter));

    expect(await runReplayCli('telemetry')).toBe(0);

    expect(await deps.redis.lrange(TELEMETRY_BUFFER_KEYS.buffer, 0, -1)).toEqual(events);
    expect(await deps.redis.llen(TELEMETRY_BUFFER_KEYS.deadLetter)).toBe(0);
  });

  it('leaves unreadable entries in the DLQ and exits 1', async () => {
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.deadLetter, 'garbage');

    expect(await runReplayCli('telemetry')).toBe(1);

    expect(await deps.redis.lrange(TELEMETRY_BUFFER_KEYS.deadLetter, 0, -1)).toEqual(['garbage']);
  });

  it('refuses to run without a known queue name', async () => {
    expect(await runReplayCli()).toBe(1);
    expect(await runReplayCli('emails')).toBe(1);
  });
});
