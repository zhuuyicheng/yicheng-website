import type { ContactMessage } from '../../schema/contact-message.schema.js';

/**
 * Tells the site owner about a new contact message. Implementations: `log` (development) and
 * `discord` (a channel webhook). Chosen by NOTIFIER_DRIVER, see create-notifier.ts.
 */
export interface Notifier {
  readonly driver: 'log' | 'discord';
  /** Resolves once delivered. Every failure is thrown as a NotificationError. */
  send: (message: ContactMessage) => Promise<void>;
}

/**
 * Why a notification was not delivered, and whether trying again could help. The worker
 * retries a retryable failure later (with backoff) and dead-letters the rest. DESIGN.md §8.3.
 *
 * Retryable: the network failed, it timed out, or the service said "not now" (HTTP 429, 5xx).
 * Not retryable: the service refused the request itself (other 4xx: a deleted webhook, a bad
 * payload). Sending the same request again would fail the same way.
 */
export class NotificationError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'NotificationError';
    this.retryable = options.retryable;
  }
}
