import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGracefulShutdown,
  type ShutdownStep,
} from '../../../src/lifecycle/graceful-shutdown.js';

const logger = pino({ level: 'silent' });

function recordingStep(name: string, calls: string[], close?: () => Promise<void>): ShutdownStep {
  return {
    name,
    close: async () => {
      calls.push(name);
      await close?.();
    },
  };
}

describe('createGracefulShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes every step in order, then exits with code 0', async () => {
    const calls: string[] = [];
    const exit = vi.fn();
    const { shutdown } = createGracefulShutdown({
      logger,
      timeoutMs: 1_000,
      exit,
      steps: [recordingStep('http', calls), recordingStep('redis', calls)],
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['http', 'redis']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('keeps closing later steps when one fails, and exits with code 1', async () => {
    const calls: string[] = [];
    const exit = vi.fn();
    const failing = recordingStep('redis', calls, () => Promise.reject(new Error('boom')));
    const { shutdown } = createGracefulShutdown({
      logger,
      timeoutMs: 1_000,
      exit,
      steps: [failing, recordingStep('postgres', calls)],
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['redis', 'postgres']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('honours a non-zero exit code requested by the caller', async () => {
    const exit = vi.fn();
    const { shutdown } = createGracefulShutdown({ logger, timeoutMs: 1_000, exit, steps: [] });

    await shutdown('startup failure', 1);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('forces exit with code 1 when steps exceed the timeout', async () => {
    const exit = vi.fn();
    const neverCloses: ShutdownStep = { name: 'stuck', close: () => new Promise(() => undefined) };
    const { shutdown } = createGracefulShutdown({
      logger,
      timeoutMs: 500,
      exit,
      steps: [neverCloses],
    });

    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(500);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('ignores repeated shutdown requests and still closes every step once', async () => {
    const calls: string[] = [];
    const exit = vi.fn();
    const { shutdown } = createGracefulShutdown({
      logger,
      timeoutMs: 1_000,
      exit,
      steps: [recordingStep('http', calls), recordingStep('redis', calls)],
    });

    const first = shutdown('SIGINT');
    await shutdown('SIGINT');
    await first;

    expect(calls).toEqual(['http', 'redis']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
