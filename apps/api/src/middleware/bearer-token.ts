import { createHash, timingSafeEqual } from 'node:crypto';
import type { onRequestHookHandler } from 'fastify';
import { AppError, ErrorCode } from '../errors/app-error.js';

/**
 * Lets only `Authorization: Bearer <token>` through, else 401 (/metrics, /api/v1/admin/*).
 * Compares hashes with `timingSafeEqual`: `===` returns sooner on a wrong first character,
 * which leaks the token one character at a time.
 */
export function requireBearerToken(token: string): onRequestHookHandler {
  const expected = sha256(token);

  return (request, reply, done) => {
    const match = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '');
    const given = sha256(match?.[1] ?? '');

    if (!match || !timingSafeEqual(given, expected)) {
      // Which kind of credentials to send (RFC 6750).
      void reply.header('www-authenticate', 'Bearer');
      done(new AppError(ErrorCode.UNAUTHORIZED, 'A valid bearer token is required'));
      return;
    }
    done();
  };
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}
