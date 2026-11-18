import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { SlidingWindowRequest, SlidingWindowResult } from '../../../src/dal/rate-limit.dal.js';
import { AppError } from '../../../src/errors/app-error.js';
import { createMetrics } from '../../../src/infra/metrics.js';
import { createRateLimiterManager } from '../../../src/services/rate-limiter.manager.js';
import { counterValue } from '../../helpers/metrics.js';

const log = pino({ level: 'silent' });
const NOW_MS = 1_763_456_000_000;
const OUTAGE = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

/** A rate limiter whose Redis DAL answers with `result` (or fails), recording every call. */
function setup(result: SlidingWindowResult | Error) {
  const calls: { key: string; request: SlidingWindowRequest }[] = [];
  const metrics = createMetrics();
  const limiter = createRateLimiterManager({
    limiter: 'contact',
    rateLimitDal: {
      consume: (key, request) => {
        calls.push({ key, request });
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
    },
    hashIp: (ip) => `hash(${ip})`,
    metrics,
    max: 3,
    windowSeconds: 600,
    now: () => NOW_MS,
    newMemberId: () => 'member-id',
  });
  return { limiter, calls, metrics };
}

describe('RateLimiterManager.consume', () => {
  it('asks Redis with the hashed IP, the window in ms and a unique member', async () => {
    const { limiter, calls } = setup({ allowed: true, remaining: 2, retryAfterMs: 0 });

    await limiter.consume('203.0.113.7', log);

    expect(calls).toEqual([
      {
        key: 'ratelimit:contact:hash(203.0.113.7)', // never the raw IP
        request: {
          nowMs: NOW_MS,
          windowMs: 600_000,
          limit: 3,
          member: `${String(NOW_MS)}-member-id`,
        },
      },
    ]);
  });

  it('reports an allowed request with what is left, and counts it', async () => {
    const { limiter, metrics } = setup({ allowed: true, remaining: 2, retryAfterMs: 0 });

    const outcome = await limiter.consume('203.0.113.7', log);

    expect(outcome).toEqual({ allowed: true, limit: 3, remaining: 2, retryAfterSeconds: 0 });
    expect(
      await counterValue(metrics.rateLimitDecisions, { limiter: 'contact', decision: 'allowed' }),
    ).toBe(1);
  });

  it('rounds the retry delay of a denied request UP to whole seconds', async () => {
    const { limiter, metrics } = setup({ allowed: false, remaining: 0, retryAfterMs: 1_001 });

    const outcome = await limiter.consume('203.0.113.7', log);

    // 1.001 s rounded down would tell the client to come back a millisecond too early.
    expect(outcome).toEqual({ allowed: false, limit: 3, remaining: 0, retryAfterSeconds: 2 });
    expect(
      await counterValue(metrics.rateLimitDecisions, { limiter: 'contact', decision: 'denied' }),
    ).toBe(1);
  });

  it('fails closed with a 503 when Redis is unavailable, and counts the error', async () => {
    const { limiter, metrics } = setup(OUTAGE);

    const error = await limiter.consume('203.0.113.7', log).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    expect(await counterValue(metrics.rateLimitErrors, { limiter: 'contact' })).toBe(1);
  });

  it('lets an error that is not an outage (a bug) surface unchanged', async () => {
    const bug = new TypeError('a bug');
    const { limiter, metrics } = setup(bug);

    await expect(limiter.consume('203.0.113.7', log)).rejects.toBe(bug);
    expect(await counterValue(metrics.rateLimitErrors)).toBe(0);
  });
});
