import { describe, expect, it } from 'vitest';
import { simulate, windowAt } from '@/lib/sliding-window';

describe('simulate (the API limiter, replayed in seconds)', () => {
  it('allows `limit` requests per window, then denies until the oldest leaves', () => {
    // The same scenario as the API's integration test, scaled from ms to s and 600 → 10.
    const decisions = simulate([0, 1, 2, 3], 10, 3);

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions[3]?.retryAfter).toBe(7); // the request at 0 s leaves at 10 s
  });

  it('slides: each slot frees exactly one window after its own request', () => {
    const decisions = simulate([0, 1, 2, 10, 10.5, 11], 10, 3);

    // At 10 s the 0 s request has left (the window is (0, 10]); 1 s and 2 s still count.
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, true, false, true]);
    expect(decisions[4]?.retryAfter).toBe(0.5);
  });

  it('does not count denied requests: hammering never extends the lockout', () => {
    const hammering = simulate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10, 3);

    expect(hammering.at(-1)?.allowed).toBe(true); // 10 s: the 0 s request left, as if no spam
  });

  it('decides in time order, whatever order the requests were added in', () => {
    expect(simulate([5, 1, 3], 10, 2).map((d) => [d.at, d.allowed])).toEqual([
      [1, true],
      [3, true],
      [5, false],
    ]);
  });
});

describe('windowAt', () => {
  it('counts the accepted requests in (now − window, now] and when a slot frees', () => {
    const decisions = simulate([1, 2, 3, 20], 10, 3);

    expect(windowAt(decisions, 5, 10, 3)).toEqual({ used: 3, remaining: 0, freesIn: 6 });
    expect(windowAt(decisions, 12, 10, 3)).toEqual({ used: 1, remaining: 2, freesIn: 0 });
    expect(windowAt(decisions, 0.5, 10, 3)).toEqual({ used: 0, remaining: 3, freesIn: 0 });
  });
});
