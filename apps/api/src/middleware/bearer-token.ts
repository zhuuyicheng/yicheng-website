import { createHash, timingSafeEqual } from 'node:crypto';
import type { onRequestHookHandler } from 'fastify';
import { AppError, ErrorCode } from '../errors/app-error.js';

/**
 * A route hook that only lets requests with `Authorization: Bearer <token>` through; the rest
 * get 401 (DESIGN.md §7.2). Used for GET /metrics when METRICS_TOKEN is set.
 *
 * Why the hashing and `timingSafeEqual` instead of `given === token`: `===` stops at the first
 * different character, so a wrong guess that starts right takes a few nanoseconds longer. With
 * enough tries, an attacker can measure that and recover the token one character at a time.
 * `timingSafeEqual` always compares every byte; it needs equal lengths, and hashing both sides
 * first gives that without revealing the token's length.
 */
export function requireBearerToken(token: string): onRequestHookHandler {
  const expected = sha256(token);

  return (request, reply, done) => {
    const match = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '');
    const given = sha256(match?.[1] ?? '');

    if (!match || !timingSafeEqual(given, expected)) {
      // Tells the client which kind of credentials to send (RFC 6750).
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
