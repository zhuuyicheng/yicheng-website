import { z } from 'zod';

/**
 * POST /api/v1/contact (DESIGN.md §7.6). The web app's form validates with the very same
 * schema before sending, so a visitor sees "must be a valid email address" instantly, and the
 * API can never disagree with the form about what is valid.
 */

export const CONTACT_MESSAGE_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

/** Limits mirror the CHECK constraints in migration 0005. */
export const CONTACT_LIMITS = { name: 100, email: 254, message: 5000 } as const;

export const contactRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'is required')
    .max(CONTACT_LIMITS.name, `must be at most ${CONTACT_LIMITS.name} characters`),
  // Trimmed first, then checked: a pasted address often carries a stray space.
  email: z
    .string()
    .trim()
    .pipe(
      z
        .email('must be a valid email address')
        .max(CONTACT_LIMITS.email, `must be at most ${CONTACT_LIMITS.email} characters`),
    ),
  message: z
    .string()
    .trim()
    .min(1, 'is required')
    .max(CONTACT_LIMITS.message, `must be at most ${CONTACT_LIMITS.message} characters`),
});

export type ContactRequest = z.infer<typeof contactRequestSchema>;

/** `202` body. `PENDING`: stored, and the notification is queued. */
export const contactAcceptedSchema = z.object({
  id: z.string(),
  status: z.enum(CONTACT_MESSAGE_STATUSES),
});

export type ContactAccepted = z.infer<typeof contactAcceptedSchema>;
