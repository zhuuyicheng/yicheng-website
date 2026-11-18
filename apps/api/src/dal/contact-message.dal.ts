import type { ContactMessageRow } from '../dao/contact-message.dao.js';
import type { PostgresPool } from '../infra/postgres.js';
import type { ContactMessage, NewContactMessage } from '../schema/contact-message.schema.js';

/** Postgres DAL for `contact_messages` (DESIGN.md §5.4). */
export interface ContactMessageDal {
  /** Stores a new message as `PENDING` and returns it with its generated id. */
  insert: (message: NewContactMessage) => Promise<ContactMessage>;
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
