import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import { REQUEST_ID_HEADER } from './request-id.js';

/**
 * Browser-facing protections (DESIGN.md §12). Both are standard Fastify plugins.
 *
 * Helmet sets response headers that tell browsers to be stricter, e.g.
 *   - `X-Content-Type-Options: nosniff`: never guess a different content type than declared;
 *   - `Strict-Transport-Security`: once seen over HTTPS, only ever use HTTPS for this host;
 *   - `Content-Security-Policy`, `X-Frame-Options`: no scripts, frames or embedding from
 *     elsewhere (little to protect in JSON, but they cost nothing and cover mistakes).
 *
 * CORS (Cross-Origin Resource Sharing): browsers stop JavaScript on one origin
 * (http://localhost:3000, the web app) from reading responses of another (http://localhost:4000,
 * the API) unless the API says that origin is allowed. Only `origins` are; any other site gets
 * no `Access-Control-Allow-Origin` header, and the browser hides the response from its script.
 * CORS is a rule browsers enforce for their users, not access control: curl ignores it.
 */
export function registerSecurityPlugins(
  app: FastifyInstance,
  options: { corsOrigins: readonly string[] },
): void {
  void app.register(helmet, { global: true });

  void app.register(cors, {
    origin: [...options.corsOrigins],
    methods: ['GET', 'POST'],
    // Headers the web app may send. JSON bodies need content-type, which makes the browser ask
    // first with an OPTIONS "preflight" request.
    allowedHeaders: ['content-type', REQUEST_ID_HEADER],
    // Headers its scripts may read. Browsers hide all but a few basic ones unless listed: the
    // contact form needs the rate-limit headers to say "try again in 5 minutes".
    exposedHeaders: [
      REQUEST_ID_HEADER,
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'retry-after',
      'x-cache',
    ],
    // Browsers may remember a preflight answer for 10 minutes instead of asking every time.
    maxAge: 600,
  });
}
