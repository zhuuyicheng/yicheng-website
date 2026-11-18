import type { ContactMessageRow } from '../dao/contact-message.dao.js';
import type { PostgresPool } from '../infra/postgres.js';
import type { ContactMessage, NewContactMessage } from '../schema/contact-message.schema.js';

/** A PENDING message the reconciler picked up, with the attempts it has had so far. */
export interface StalePendingMessage {
  id: string;
  attempts: number;
}

/**
 * Postgres DAL for `contact_messages` (DESIGN.md §5.4). The API inserts; the worker reads
 * messages and records how notifying went.
 *
 * Every status update only touches a message that is still `PENDING`. A job can run twice
 * (delivery is at least once), and the second run must never undo the first one's result.
 */
export interface ContactMessageDal {
  /** API: stores a new message as `PENDING` and returns it with its generated id. */
  insert: (message: NewContactMessage) => Promise<ContactMessage>;
  /** Worker: the message a job points to, or `null` if it no longer exists. */
  findById: (id: string) => Promise<ContactMessage | null>;
  /** Worker: the notification was delivered on attempt `attempt`. */
  markSent: (id: string, attempt: number) => Promise<void>;
  /** Worker: attempt `attempt` failed and will be retried. Also refreshes `updated_at`. */
  recordFailedAttempt: (id: string, attempt: number, error: string) => Promise<void>;
  /** Worker: attempt `attempt` failed and notifying gives up. */
  markFailed: (id: string, attempt: number, error: string) => Promise<void>;
  /**
   * Reconciler: up to `limit` messages still PENDING whose `updated_at` is older than
   * `olderThanSeconds`. Claims them by setting `updated_at = now()` in the same statement,
   * so the next run (or a second reconciler) does not pick them up again right away.
   */
  claimStalePending: (olderThanSeconds: number, limit: number) => Promise<StalePendingMessage[]>;
  /** `dlq:replay`: puts a FAILED message back to PENDING with 0 attempts, to try again. */
  reopenFailed: (id: string) => Promise<void>;
}

// Matches dao/contact-message.dao.ts, minus `ip_hash`: nothing that reads a message needs it.
const COLUMNS = 'id, name, email, message, status, attempts, last_error, created_at, sent_at';

type ReadRow = Pick<
  ContactMessageRow,
  | 'id'
  | 'name'
  | 'email'
  | 'message'
  | 'status'
  | 'attempts'
  | 'last_error'
  | 'created_at'
  | 'sent_at'
>;

export function createContactMessageDal(pool: PostgresPool): ContactMessageDal {
  return {
    async insert({ name, email, message, ipHash }) {
      // id, status, attempts and timestamps come from the column DEFAULTs.
      const result = await pool.query<ReadRow>(
        `INSERT INTO contact_messages (name, email, message, ip_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING ${COLUMNS}`,
        [name, email, message, ipHash],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('INSERT … RETURNING returned no row');
      }
      return toContactMessage(row);
    },

    async findById(id) {
      const result = await pool.query<ReadRow>(
        `SELECT ${COLUMNS} FROM contact_messages WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? toContactMessage(row) : null;
    },

    async markSent(id, attempt) {
      await pool.query(
        `UPDATE contact_messages
            SET status = 'SENT', attempts = $2, sent_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'PENDING'`,
        [id, attempt],
      );
    },

    async recordFailedAttempt(id, attempt, error) {
      await pool.query(
        `UPDATE contact_messages
            SET attempts = $2, last_error = $3, updated_at = now()
          WHERE id = $1 AND status = 'PENDING'`,
        [id, attempt, error],
      );
    },

    async markFailed(id, attempt, error) {
      await pool.query(
        `UPDATE contact_messages
            SET status = 'FAILED', attempts = $2, last_error = $3, updated_at = now()
          WHERE id = $1 AND status = 'PENDING'`,
        [id, attempt, error],
      );
    },

    async claimStalePending(olderThanSeconds, limit) {
      // The subquery finds the oldest stale messages using the partial index on
      // (updated_at) WHERE status = 'PENDING'. SKIP LOCKED: rows another transaction is
      // claiming right now are skipped instead of waited for.
      const result = await pool.query<Pick<ContactMessageRow, 'id' | 'attempts'>>(
        `UPDATE contact_messages
            SET updated_at = now()
          WHERE id IN (SELECT id FROM contact_messages
                        WHERE status = 'PENDING'
                          AND updated_at < now() - make_interval(secs => $1)
                        ORDER BY updated_at
                        LIMIT $2
                          FOR UPDATE SKIP LOCKED)
          RETURNING id, attempts`,
        [olderThanSeconds, limit],
      );
      return result.rows.map((row) => ({ id: row.id, attempts: row.attempts }));
    },

    async reopenFailed(id) {
      await pool.query(
        `UPDATE contact_messages
            SET status = 'PENDING', attempts = 0, updated_at = now()
          WHERE id = $1 AND status = 'FAILED'`,
        [id],
      );
    },
  };
}

function toContactMessage(row: ReadRow): ContactMessage {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    message: row.message,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}
