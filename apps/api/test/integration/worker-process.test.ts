import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createContactMessageDal } from '../../src/dal/contact-message.dal.js';
import { TELEMETRY_BUFFER_KEYS } from '../../src/dal/event-buffer.dal.js';
import { NOTIFICATION_QUEUE_KEYS } from '../../src/dal/notification-queue.dal.js';
import { notificationJobJson } from '../helpers/contact-messages.js';
import { bufferedEventJson } from '../helpers/telemetry-events.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';
import { integrationTestEnv } from './test-env.js';

const API_ROOT = path.resolve(import.meta.dirname, '../..');

interface LogLine {
  msg?: string;
  metricsAddress?: string;
}

/**
 * The real worker as a child process, with a flush interval too long to flush again: anything
 * flushed after SIGTERM came from draining. Waits for `readyMessage` in the log.
 */
function startWorkerProcess(readyMessage = 'telemetry buffer empty') {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      ...integrationTestEnv,
      LOG_LEVEL: 'debug', // to see "telemetry buffer empty"
      TELEMETRY_BATCH_SIZE: '2',
      TELEMETRY_FLUSH_INTERVAL_MS: '300000',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const logs: LogLine[] = [];
  const lines: string[] = [];
  const idle = new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => {
      reject(new Error(`worker exited early with code ${String(code)}`));
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      lines.push(line);
      const entry = JSON.parse(line) as LogLine;
      logs.push(entry);
      if (entry.msg === readyMessage) {
        resolve(); // e.g. the flush loop checked once and is sleeping
      }
    });
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once('close', resolve); // 'close', not 'exit': every log line has been read by then
  });

  /** The worker's log, for failure messages (CI shows nothing else). */
  const log = () => `worker log:\n${lines.join('\n')}`;

  return { child, logs, idle, exited, log };
}

describe('worker process lifecycle', () => {
  let deps: TestDependencies;
  let child: ChildProcess | undefined;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterEach(() => {
    if (child?.exitCode === null) {
      child.kill('SIGKILL');
    }
  });

  afterAll(async () => {
    await deps.close();
  });

  it('on SIGTERM, drains the whole buffer into Postgres, then exits with code 0', async () => {
    await deps.redis.flushdb(); // Redis DB 1 (tests) only
    await deps.postgres.query('TRUNCATE analytics_events');
    const worker = startWorkerProcess();
    child = worker.child;
    await worker.idle;

    // Five events while the worker sleeps: three batches of at most two.
    const events = Array.from({ length: 5 }, () => bufferedEventJson());
    await deps.redis.rpush(TELEMETRY_BUFFER_KEYS.buffer, ...events);
    worker.child.kill('SIGTERM');

    expect(await worker.exited, worker.log()).toBe(0);
    const rows = await deps.postgres.query('SELECT 1 FROM analytics_events');
    expect(rows.rowCount).toBe(5);
    expect(await deps.redis.llen(TELEMETRY_BUFFER_KEYS.buffer)).toBe(0);
    expect(await deps.redis.llen(TELEMETRY_BUFFER_KEYS.inflight)).toBe(0);
    const messages = worker.logs.map((entry) => entry.msg);
    expect(messages).toEqual(
      expect.arrayContaining(['shutdown started', 'telemetry buffer drained', 'shutdown complete']),
    );
  });

  it('serves /metrics for Prometheus while it runs', async () => {
    const worker = startWorkerProcess('worker started');
    child = worker.child;
    await worker.idle;
    const address = worker.logs.find((entry) => entry.msg === 'worker started')?.metricsAddress;
    expect(address, worker.log()).toMatch(/^http:\/\//);

    // Any free port (test-env.ts), so read it from the log.
    const { port } = new URL(String(address));
    const response = await fetch(`http://127.0.0.1:${port}/metrics`);

    expect(response.status).toBe(200);
    const body = await response.text();
    // Counted only in the worker, so unreadable before it served them.
    expect(body).toContain('# TYPE telemetry_events_flushed_total counter');
    expect(body).toContain('# TYPE worker_loop_failures_total counter');
    expect(body).toContain('process_resident_memory_bytes'); // a real process's own numbers
    worker.child.kill('SIGTERM');
    expect(await worker.exited, worker.log()).toBe(0);
  });

  it('sends a queued contact notification (log notifier), and stops without waiting on BLMOVE', async () => {
    await deps.redis.flushdb(); // Redis DB 1 (tests) only
    await deps.postgres.query('TRUNCATE contact_messages');
    const message = await createContactMessageDal(deps.postgres).insert({
      name: 'Ada',
      email: 'ada@example.com',
      message: 'Hello!',
      ipHash: 'a'.repeat(64),
    });
    await deps.redis.lpush(
      NOTIFICATION_QUEUE_KEYS.ready,
      notificationJobJson({ messageId: message.id }),
    );

    const worker = startWorkerProcess('notification sent');
    child = worker.child;
    await worker.idle;

    // The consumer is waiting in BLMOVE (up to 5 s); shutdown must cut that short.
    const stopAskedAt = Date.now();
    worker.child.kill('SIGTERM');
    expect(await worker.exited, worker.log()).toBe(0);
    expect(Date.now() - stopAskedAt).toBeLessThan(3_000);

    const rows = await deps.postgres.query<{ status: string }>(
      'SELECT status FROM contact_messages WHERE id = $1',
      [message.id],
    );
    expect(rows.rows[0]?.status).toBe('SENT');
    expect(worker.logs.map((entry) => entry.msg)).toContain('notification consumer stopped');
  });
});
