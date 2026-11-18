/**
 * Row type for `contact_messages` (migration 0005), column for column. The API inserts rows;
 * the worker's notification consumer updates `status`, `attempts`, `last_error` and `sent_at`.
 */
export interface ContactMessageRow {
  id: string;
  name: string;
  email: string;
  message: string;
  /** HMAC-SHA256(IP_HASH_SECRET, ip): the same sender gives the same hash, the IP stays secret. */
  ip_hash: string;
  /** PENDING until the owner has been notified (SENT) or notifying gave up (FAILED). */
  status: 'PENDING' | 'SENT' | 'FAILED';
  /** Notification attempts so far. */
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
}
