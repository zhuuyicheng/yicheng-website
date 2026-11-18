import type { ContactMessageStatus, ContactRequest } from '@portfolio/shared';

/**
 * Contact messages. See DESIGN.md §7.6 and §8.3.
 *
 * Shapes:
 *   1. `ContactRequest`: what a visitor sends to POST /api/v1/contact. Public contract, so it
 *      lives in `@portfolio/shared` (the web app's form validates with the same schema).
 *   2. `ContactMessage`: a stored message, as the DAL returns it.
 *   3. `ContactAccepted`: the response body (also in `@portfolio/shared`).
 */

export {
  CONTACT_MESSAGE_STATUSES,
  contactRequestSchema,
  type ContactAccepted,
  type ContactMessageStatus,
  type ContactRequest,
} from '@portfolio/shared';

// ---------------------------------------------------------------------------------------------
// 2. Stored message
// ---------------------------------------------------------------------------------------------

/** What the DAL needs to insert a message. */
export interface NewContactMessage extends ContactRequest {
  ipHash: string;
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  status: ContactMessageStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
}
