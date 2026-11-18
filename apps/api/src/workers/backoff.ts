const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

/**
 * How long a worker loop waits after `consecutiveFailures` failed iterations in a row:
 * 0.5 s, 1 s, 2 s, 4 s, … capped at 30 s. Shared by every loop in workers/.
 *
 * Why back off: during an outage, retrying in a tight loop floods the logs and hammers a
 * datastore that is trying to come back. Waiting longer each time keeps both calm, and the
 * cap means the loop notices the recovery within 30 s.
 */
export function backoffMs(consecutiveFailures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), BACKOFF_MAX_MS);
}
