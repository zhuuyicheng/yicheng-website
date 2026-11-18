import { describe, expect, it } from 'vitest';
import { createRollingLatency, percentile } from '../../../src/infra/rolling-latency.js';

describe('percentile (nearest rank)', () => {
  it('picks the value that p % of requests were at or below', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1); // 1 … 20 ms

    expect(percentile(twenty, 50)).toBe(10);
    expect(percentile(twenty, 95)).toBe(19);
    expect(percentile([7], 95)).toBe(7);
  });

  it('is null without samples, and rounds to 1 decimal', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1.234], 50)).toBe(1.2);
  });
});

describe('createRollingLatency', () => {
  it('summarises the requests of the window', () => {
    const latency = createRollingLatency({ now: () => 1_000 });
    for (const ms of [5, 1, 3, 2, 4]) {
      latency.record(ms);
    }

    expect(latency.snapshot()).toEqual({ windowSeconds: 300, requestCount: 5, p50: 3, p95: 5 });
  });

  it('forgets requests older than the window', () => {
    let clock = 0;
    const latency = createRollingLatency({ windowMs: 60_000, now: () => clock });
    latency.record(900); // a slow request …
    clock = 30_000;
    latency.record(10);

    clock = 61_000; // … that is now more than a minute old
    expect(latency.snapshot()).toMatchObject({ requestCount: 1, p50: 10, p95: 10 });
  });

  it('keeps constant memory: beyond capacity, the oldest samples are overwritten', () => {
    const latency = createRollingLatency({ capacity: 3, now: () => 1_000 });
    for (const ms of [100, 100, 1, 2, 3]) {
      latency.record(ms);
    }

    expect(latency.snapshot()).toMatchObject({ requestCount: 3, p95: 3 });
  });

  it('reports no latency at all before the first request', () => {
    expect(createRollingLatency().snapshot()).toEqual({
      windowSeconds: 300,
      requestCount: 0,
      p50: null,
      p95: null,
    });
  });
});
