import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import { REQUEST_ID_HEADER } from './request-id.js';

/**
 * Helmet (stricter browser headers) and CORS (DESIGN.md §12). CORS lets only `origins` read
 * the API's responses in a browser; it isn't access control (curl ignores it).
 */
export function registerSecurityPlugins(
  app: FastifyInstance,
  options: { corsOrigins: readonly string[] },
): void {
  void app.register(helmet, { global: true });

  void app.register(cors, {
    origin: [...options.corsOrigins],
    methods: ['GET', 'POST'],
    // Headers the web app may send. JSON's content-type triggers a preflight OPTIONS request.
    allowedHeaders: ['content-type', REQUEST_ID_HEADER],
    // Headers its scripts may read: the contact form shows the rate-limit ones.
    exposedHeaders: [
      REQUEST_ID_HEADER,
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-window',
      'retry-after',
      'x-cache',
    ],
    // Browsers may cache a preflight answer for 10 minutes.
    maxAge: 600,
  });
}
