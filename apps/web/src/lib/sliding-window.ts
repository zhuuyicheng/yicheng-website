/**
 * The API's sliding-window rate limiter (apps/api/src/dal/lua/sliding-window.lua.ts), replayed
 * in the browser for the interactive demo on the home page. Same rule, in seconds instead of
 * milliseconds: a request is allowed if fewer than `limit` accepted requests are newer than
 * `now − window`; rejected requests are not counted.
 */

export interface RequestDecision {
  /** Seconds from the start of the demo timeline. */
  at: number;
  allowed: boolean;
  /** For a denied request: seconds until the oldest accepted request leaves the window. */
  retryAfter: number;
}

/** Decides every request in time order, exactly as Redis would, one after another. */
export function simulate(
  times: readonly number[],
  window: number,
  limit: number,
): RequestDecision[] {
  const accepted: number[] = []; // the sorted set: times of accepted requests, oldest first
  return [...times]
    .sort((a, b) => a - b)
    .map((at) => {
      // ZREMRANGEBYSCORE key -inf (now - window): forget what has left the window.
      while (accepted.length > 0 && (accepted[0] ?? 0) <= at - window) {
        accepted.shift();
      }
      if (accepted.length < limit) {
        accepted.push(at); // ZADD
        return { at, allowed: true, retryAfter: 0 };
      }
      const oldest = accepted[0] ?? at;
      return { at, allowed: false, retryAfter: oldest + window - at };
    });
}

export interface WindowState {
  /** Accepted requests inside `(now − window, now]`. */
  used: number;
  remaining: number;
  /** When the window is full: seconds until a slot frees up. 0 otherwise. */
  freesIn: number;
}

/** What the limiter's sorted set looks like at time `now`. */
export function windowAt(
  decisions: readonly RequestDecision[],
  now: number,
  window: number,
  limit: number,
): WindowState {
  const inWindow = decisions.filter((d) => d.allowed && d.at > now - window && d.at <= now);
  const used = inWindow.length;
  const oldest = inWindow[0]?.at;
  return {
    used,
    remaining: Math.max(0, limit - used),
    freesIn: used >= limit && oldest !== undefined ? oldest + window - now : 0,
  };
}
