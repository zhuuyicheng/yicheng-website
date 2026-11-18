import { describe, expect, it } from 'vitest';
import {
  createDiscordNotifier,
  toWebhookPayload,
} from '../../../../src/infra/notifiers/discord.notifier.js';
import { NotificationError } from '../../../../src/infra/notifiers/notifier.js';
import { contactMessage } from '../../../helpers/contact-messages.js';

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/secret-token';

/** A notifier whose `fetch` answers with `answer` (or fails), recording each request. */
function setup(answer: Response | Error | 'hang', timeoutMs = 5_000) {
  const requests: { url: string; body: unknown; method: string | undefined }[] = [];
  const fakeFetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ url, body, method: init.method });
    if (answer === 'hang') {
      // Never answers; only the abort signal (our timeout) ends it, like a dead server.
      return new Promise<Response>((_resolve, reject) => {
        const { signal } = init;
        signal?.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        });
      });
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  const notifier = createDiscordNotifier({ webhookUrl: WEBHOOK_URL, timeoutMs, fetch: fakeFetch });
  return { notifier, requests };
}

/** The NotificationError that `send` failed with. */
async function failure(promise: Promise<void>): Promise<NotificationError> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof NotificationError)) {
    throw new Error(`expected a NotificationError, got ${String(error)}`);
  }
  return error;
}

describe('Discord notifier', () => {
  it('POSTs the message as JSON to the webhook and resolves on 204', async () => {
    const { notifier, requests } = setup(new Response(null, { status: 204 }));

    await notifier.send(contactMessage());

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(WEBHOOK_URL);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.body).toEqual(
      JSON.parse(JSON.stringify(toWebhookPayload(contactMessage()))),
    );
  });

  it.each([429, 500, 502, 503])('treats HTTP %i as retryable ("not now")', async (status) => {
    const { notifier } = setup(new Response('busy', { status }));

    const error = await failure(notifier.send(contactMessage()));

    expect(error.retryable).toBe(true);
    expect(error.message).toBe(`Discord webhook answered ${String(status)}: busy`);
  });

  it.each([400, 401, 404])(
    'treats HTTP %i as not retryable (asking again fails again)',
    async (status) => {
      const body = '{"message": "Unknown Webhook", "code": 10015}';
      const { notifier } = setup(new Response(body, { status }));

      const error = await failure(notifier.send(contactMessage()));

      expect(error.retryable).toBe(false);
      expect(error.message).toContain('Unknown Webhook');
    },
  );

  it('treats a network failure as retryable, naming the error code', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    const { notifier } = setup(refused);

    const error = await failure(notifier.send(contactMessage()));

    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Discord webhook request failed: ECONNREFUSED');
  });

  it('gives up on a server that never answers, and counts it as retryable', async () => {
    const { notifier } = setup('hang', 20);

    const error = await failure(notifier.send(contactMessage()));

    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Discord webhook request failed: timed out after 20 ms');
  });

  it('never puts the webhook URL (it contains the token) in an error message', async () => {
    const withUrl = new TypeError(`fetch failed for ${WEBHOOK_URL}`);
    const { notifier } = setup(withUrl);

    const error = await failure(notifier.send(contactMessage()));

    expect(error.message).not.toContain('secret-token');
  });
});

describe('toWebhookPayload', () => {
  it('turns off mentions: a stranger typing @everyone must not ping the channel', () => {
    const payload = toWebhookPayload(contactMessage({ message: '@everyone free money' }));

    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it('shows the name, email and text, and truncates text beyond Discord’s embed limit', () => {
    const long = 'a'.repeat(5000);
    const [embed] = toWebhookPayload(contactMessage({ message: long })).embeds;

    expect(embed?.title).toBe('New message from Ada');
    expect(embed?.fields).toEqual([{ name: 'Email', value: 'ada@example.com' }]);
    expect(embed?.description.length).toBeLessThanOrEqual(4096);
    expect(embed?.description).toMatch(/truncated; the full text is in Postgres\)$/);
  });
});
