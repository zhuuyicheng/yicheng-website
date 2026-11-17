import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';
import { integrationTestEnv } from './test-env.js';

const API_ROOT = path.resolve(import.meta.dirname, '../..');

interface LogLine {
  msg?: string;
  address?: string;
  exitCode?: number;
}

/**
 * Starts the real API entrypoint as a child process, so this exercises what `npm start`
 * does: config loading, datastore connection, listening, and signal handling.
 */
function startApiProcess(): { child: ChildProcess; logs: LogLine[]; started: Promise<string> } {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      ...integrationTestEnv,
      LOG_LEVEL: 'info',
      API_HOST: '127.0.0.1',
      API_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const logs: LogLine[] = [];
  const started = new Promise<string>((resolve, reject) => {
    child.once('exit', (code) => {
      reject(new Error(`API exited early with code ${String(code)}`));
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const entry = JSON.parse(line) as LogLine;
      logs.push(entry);
      if (entry.msg === 'api started' && entry.address) {
        resolve(entry.address);
      }
    });
  });

  return { child, logs, started };
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
}

describe('API process lifecycle', () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    if (child?.exitCode === null) {
      child.kill('SIGKILL');
    }
  });

  it('serves /health, then shuts down cleanly with exit code 0 on SIGTERM', async () => {
    const api = startApiProcess();
    child = api.child;
    const address = await api.started;

    const health = await fetch(`${address}/health`);
    expect(health.status).toBe(200);

    const exited = waitForExit(api.child);
    api.child.kill('SIGTERM');

    expect(await exited).toBe(0);
    const messages = api.logs.map((entry) => entry.msg);
    expect(messages).toContain('shutdown started');
    expect(messages).toContain('shutdown complete');
  });
});
