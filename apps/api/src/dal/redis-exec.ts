import type { ChainableCommander } from 'ioredis';

/**
 * Runs a MULTI or pipeline and returns each result, or throws if any command failed: ioredis
 * reports a failed command as `[error, null]` and runs the rest, so it would go unnoticed.
 */
export async function execOrThrow(batch: ChainableCommander): Promise<unknown[]> {
  const results = await batch.exec();
  if (results === null) {
    throw new Error('Redis transaction aborted');
  }
  return results.map(([error, result]) => {
    if (error) {
      throw error;
    }
    return result;
  });
}

/** A result that must be a list of strings (LRANGE, ZRANGE); anything else is a bug. */
export function stringList(result: unknown): string[] {
  if (!Array.isArray(result)) {
    throw new Error('Redis answered something other than a list');
  }
  return result.map((item: unknown) => {
    if (typeof item !== 'string') {
      throw new Error('Redis answered a list that is not all strings');
    }
    return item;
  });
}
