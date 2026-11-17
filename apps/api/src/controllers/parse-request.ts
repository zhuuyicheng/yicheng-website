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
