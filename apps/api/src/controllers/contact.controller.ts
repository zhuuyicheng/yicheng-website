import type { FastifyInstance } from 'fastify';
import { rateLimit } from '../middleware/rate-limit.js';
import { contactRequestSchema } from '../schema/contact-message.schema.js';
import type { ContactManager } from '../services/contact.manager.js';
import type { RateLimiterManager } from '../services/rate-limiter.manager.js';
import { renderContactAccepted } from '../views/contact.view.js';
import { API_V1 } from './api-v1.js';
import { parseRequest } from './parse-request.js';

/** The contact form. See DESIGN.md §7.6. */
export function registerContactController(
  app: FastifyInstance,
  contactManager: ContactManager,
  rateLimiter: RateLimiterManager,
): void {
  /**
   * The rate limiter runs first (an `onRequest` hook), then validation, then the manager.
   * 202 Accepted, not 201 Created: the message is stored, but the notification it triggers
   * has only been queued.
   */
  app.post(`${API_V1}/contact`, { onRequest: rateLimit(rateLimiter) }, async (request, reply) => {
    const message = parseRequest(contactRequestSchema, request.body);
    const accepted = await contactManager.submit(message, { ip: request.ip }, request.log);
    return reply.status(202).send(renderContactAccepted(accepted));
  });
}
