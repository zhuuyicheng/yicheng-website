import type { ChainableCommander } from 'ioredis';

/**
 * Sends a batch of Redis commands (`redis.multi()` or `redis.pipeline()`) and returns each
 * command's result, or throws if any of them failed.
 *
 * Needed because ioredis does not reject when one command in a batch fails: it reports it in
 * the results as `[error, null]`, and the other commands still run (Redis has no rollback).
 * Without checking, the failure would go unnoticed.
 *
 * MULTI vs pipeline: both send everything in one round trip; MULTI also guarantees no other
 * client's command runs in between (a transaction), which moving a job between queues needs.
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
