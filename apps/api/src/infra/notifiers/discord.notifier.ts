import type { ContactMessage } from '../../schema/contact-message.schema.js';
import { NotificationError, type Notifier } from './notifier.js';

export interface DiscordNotifierOptions {
  /** Secret: it contains the token. Never log it or put it in an error message. */
  webhookUrl: string;
  /** Give up on a request after this long; the attempt then counts as retryable. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 5_000;
/** Discord's limit for an embed description is 4096 characters; messages can be 5000. */
const MAX_DESCRIPTION_LENGTH = 4_000;

/**
 * Posts each contact message to a Discord channel through a webhook
 * (https://discord.com/developers/docs/resources/webhook#execute-webhook).
 */
export function createDiscordNotifier(options: DiscordNotifierOptions): Notifier {
  const { webhookUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetch = globalThis.fetch } = options;

  return {
    driver: 'discord',

    async send(message) {
      let response: Response;
      try {
        response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(toWebhookPayload(message)),
          // Without a timeout, a hung connection would stall the worker indefinitely.
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // No response at all: DNS, refused connection, reset, or our timeout. Worth retrying.
        throw new NotificationError(
          `Discord webhook request failed: ${describeFetchError(error, timeoutMs)}`,
          { retryable: true, cause: error },
        );
      }

      if (response.ok) {
        await response.body?.cancel(); // Discord answers 204; free the connection either way
        return;
      }

      // Discord's error body is short JSON, e.g. {"message": "Unknown Webhook", "code": 10015}.
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      const retryable = response.status === 429 || response.status >= 500;
      throw new NotificationError(
        `Discord webhook answered ${String(response.status)}${detail ? `: ${detail}` : ''}`,
        { retryable },
      );
    },
  };
}

/**
 * A short reason for a request that got no response. Built from the error's name and code
 * only: some error messages repeat the URL, and this one contains the webhook's token.
 */
function describeFetchError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  if (error.name === 'TimeoutError') {
    return `timed out after ${String(timeoutMs)} ms`;
  }
  // Node's fetch wraps network failures: TypeError('fetch failed', { cause: { code } }).
  const { cause } = error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    return typeof cause.code === 'string' ? cause.code : error.name; // e.g. ECONNREFUSED
  }
  return error.name;
}

/** The webhook request body: one embed per message. Exported for tests. */
export function toWebhookPayload(message: ContactMessage) {
  const text =
    message.message.length > MAX_DESCRIPTION_LENGTH
      ? `${message.message.slice(0, MAX_DESCRIPTION_LENGTH)}… (truncated; the full text is in Postgres)`
      : message.message;

  return {
    username: 'Portfolio contact form',
    // The text comes from a stranger: never let "@everyone" or "<@id>" in it ping anyone.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `New message from ${message.name}`,
        description: text,
        fields: [{ name: 'Email', value: message.email }],
        timestamp: message.createdAt.toISOString(),
        footer: { text: `contact_messages.id ${message.id}` },
      },
    ],
  };
}
