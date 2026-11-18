import { describe, expect, it } from 'vitest';
import { backoffMs } from '../../../src/workers/backoff.js';

describe('backoffMs', () => {
  it('doubles from 0.5 s and caps at 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMs)).toEqual([
      500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });
});
