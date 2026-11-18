import { setTimeout as delay } from 'node:timers/promises';

/**
 * Waits `ms`, or less if `signal` aborts first. Never rejects on abort: a stopping worker just
 * wakes up early instead of waiting out a long sleep.
 */
export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
}
