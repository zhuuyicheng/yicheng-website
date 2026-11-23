import type { Redis } from '../infra/redis.js';

/** 48 h for a one-day salt: made at any hour of its day, it must outlast that day. */
const SALT_TTL_SECONDS = 48 * 60 * 60;

export const telemetrySaltKey = (date: string): string => `telemetry:salt:${date}`;

/** The daily visitor-hash salt (DESIGN.md §6.2), in Redis so every replica hashes alike. */
export interface TelemetrySaltDal {
  /** The salt for `date` (UTC), else stores `candidate`; in a race the first SET NX wins. */
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

      // NX: only if the key doesn't exist, so a concurrent winner is kept.
      await redis.set(key, candidate, 'EX', SALT_TTL_SECONDS, 'NX');
      const winner = await redis.get(key);
      if (winner === null) {
        throw new Error(`telemetry salt ${key} missing right after SET NX`);
      }
      return winner;
    },
  };
}
