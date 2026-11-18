import type { z } from 'zod';
import { AppError, ErrorCode } from '../errors/app-error.js';

/**
 * Validates one part of a request (params, query, body) with a Zod schema. Invalid input
 * becomes a 400 VALIDATION_ERROR with per-field details, the same envelope as every other
 * validation failure.
 */
export function parseRequest<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const details = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'Request validation failed', { details });
}

/**
 * A body sent as `text/plain` arrives as a string (Fastify parses only JSON content types
 * into objects); this reads it as JSON. Used by POST /api/v1/events: the page-view beacon
 * sends `text/plain` on purpose, see events.controller.ts. Anything else passes through.
 */
export function jsonFromText(body: unknown): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AppError(ErrorCode.BAD_REQUEST, 'Body is not valid JSON');
  }
}
