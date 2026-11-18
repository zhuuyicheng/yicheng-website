import { createServer } from 'node:http';

export interface StubWebhook {
  /** Pass to createDiscordNotifier; plain http on 127.0.0.1 with a random free port. */
  url: string;
  /** Status codes to answer with, one per request, in order. Empty = 204 (Discord's success). */
  statuses: number[];
  /** Every request body received, parsed as JSON. */
  requests: unknown[];
  close: () => Promise<void>;
}

/** A local stand-in for a Discord webhook, so tests can make it fail on demand. */
export async function startStubWebhook(): Promise<StubWebhook> {
  const statuses: number[] = [];
  const requests: unknown[] = [];

  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      const status = statuses.shift() ?? 204;
      if (status === 204) {
        response.writeHead(204).end();
      } else {
        response
          .writeHead(status, { 'content-type': 'application/json' })
          .end(JSON.stringify({ message: `stub answered ${String(status)}` }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('stub webhook has no TCP address');
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}/api/webhooks/1/test-token`,
    statuses,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections(); // fetch keeps connections alive; do not wait for them
        server.close(() => {
          resolve();
        });
      }),
  };
}
