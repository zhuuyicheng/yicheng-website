import type { ContactMessageStatus, ContactRequest } from '@portfolio/shared';

/** Contact messages (DESIGN.md §7.6, §8.3). Request and response are shared with the form. */

export {
  CONTACT_MESSAGE_STATUSES,
  contactRequestSchema,
  type ContactAccepted,
  type ContactMessageStatus,
  type ContactRequest,
} from '@portfolio/shared';

// Stored message

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
