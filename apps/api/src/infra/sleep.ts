import { setTimeout as delay } from 'node:timers/promises';

/** Waits `ms`, or less if `signal` aborts. Never rejects: a stopping worker just wakes early. */
export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
}
