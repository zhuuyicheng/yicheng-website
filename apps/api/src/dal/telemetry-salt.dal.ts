import type { Redis } from '../infra/redis.js';

/**
 * A salt lives for 48 h although it is only used for one UTC day: created at any time during
 * its day, it must outlast that day even for a request that arrives a little late.
 */
const SALT_TTL_SECONDS = 48 * 60 * 60;

export const telemetrySaltKey = (date: string): string => `telemetry:salt:${date}`;

/**
 * Redis DAL for the daily visitor-hash salt (`telemetry:salt:{YYYY-MM-DD}`, DESIGN.md §6.2).
 * Shared through Redis so that every API instance hashes a visitor the same way.
 */
export interface TelemetrySaltDal {
  /**
   * The salt for `date` (UTC, `YYYY-MM-DD`). If none exists yet, tries to store `candidate`.
   * When several instances race, the first `SET NX` wins and everyone reads the winner.
   */
  getOrCreate: (date: string, candidate: string) => Promise<string>;
}

export function createTelemetrySaltDal(redis: Redis): TelemetrySaltDal {
  return {
    async getOrCreate(date, candidate) {
      const key = telemetrySaltKey(date);
      const existing = await redis.get(key);
      if (existing !== null) {
        return existing;
      }

      // NX: only set if the key does not exist. A concurrent winner's value is kept.
      await redis.set(key, candidate, 'EX', SALT_TTL_SECONDS, 'NX');
      const winner = await redis.get(key);
      if (winner === null) {
        throw new Error(`telemetry salt ${key} missing right after SET NX`);
      }
      return winner;
    },
  };
}
