import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Conservative charset: safe to write into logs and echo back in a response header. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Reuses the caller's x-request-id (e.g. from a proxy or the web app) so one id follows a
 * request across services. Anything unsafe or missing gets a fresh UUID instead.
 */
export function resolveRequestId(request: Pick<IncomingMessage, 'headers'>): string {
  const incoming = request.headers[REQUEST_ID_HEADER];

  if (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}
