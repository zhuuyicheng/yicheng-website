import type { ContactMessage } from '../../schema/contact-message.schema.js';

/** Tells the owner about a new contact message: `log` (development) or `discord`. */
export interface Notifier {
  readonly driver: 'log' | 'discord';
  /** Resolves once delivered; every failure is a NotificationError. */
  send: (message: ContactMessage) => Promise<void>;
}

/**
 * A failed delivery, and whether retrying could help (DESIGN.md §8.3). Retryable: network,
 * timeout, 429, 5xx. Not: other 4xx (deleted webhook, bad payload) would fail the same way.
 */
export class NotificationError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'NotificationError';
    this.retryable = options.retryable;
  }
}
