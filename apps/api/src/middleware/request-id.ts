import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Safe to write into logs and echo back in a header. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuses the caller's x-request-id so one id follows a request; otherwise a fresh UUID. */
export function resolveRequestId(request: Pick<IncomingMessage, 'headers'>): string {
  const incoming = request.headers[REQUEST_ID_HEADER];

  if (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}
