import { z } from 'zod';

/**
 * Contact messages. See DESIGN.md §7.6 and §8.3.
 *
 * Shapes:
 *   1. `ContactRequest`: what a visitor sends to POST /api/v1/contact. Untrusted, so strict.
 *   2. `ContactMessage`: a stored message, as the DAL returns it.
 *   3. `ContactAccepted`: the response body.
 */

export const CONTACT_MESSAGE_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

// ---------------------------------------------------------------------------------------------
// 1. Request body. Limits mirror the CHECK constraints in migration 0005, so bad input is a
//    400 with field details here, never a failed INSERT.
// ---------------------------------------------------------------------------------------------

export const contactRequestSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(100, 'must be at most 100 characters'),
  // Trimmed first, then checked: a pasted address often carries a stray space.
  email: z
    .string()
    .trim()
    .pipe(z.email('must be a valid email address').max(254, 'must be at most 254 characters')),
  message: z.string().trim().min(1, 'is required').max(5000, 'must be at most 5000 characters'),
});

export type ContactRequest = z.infer<typeof contactRequestSchema>;

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

// ---------------------------------------------------------------------------------------------
// 3. Response
// ---------------------------------------------------------------------------------------------

/** `PENDING`: stored, and the notification is queued. The visitor needs nothing more. */
export interface ContactAccepted {
  id: string;
  status: ContactMessageStatus;
}
