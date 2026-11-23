/** `contact_messages` (migration 0005), column for column. */
export interface ContactMessageRow {
  id: string;
  name: string;
  email: string;
  message: string;
  /** HMAC-SHA256(IP_HASH_SECRET, ip): same sender, same hash; the IP stays secret. */
  ip_hash: string;
  /** PENDING until notified (SENT) or given up (FAILED). */
  status: 'PENDING' | 'SENT' | 'FAILED';
  /** Notification attempts so far. */
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
}
