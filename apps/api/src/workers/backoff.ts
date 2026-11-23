const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

/**
 * Wait after `consecutiveFailures`: 0.5 s, 1 s, 2 s… capped at 30 s. During an outage, a tight
 * retry loop floods the logs and hammers a recovering datastore.
 */
export function backoffMs(consecutiveFailures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), BACKOFF_MAX_MS);
}
