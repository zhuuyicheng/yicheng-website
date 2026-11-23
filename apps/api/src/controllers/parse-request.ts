import type { z } from 'zod';
import { AppError, ErrorCode } from '../errors/app-error.js';

/** Validates params, query or body; invalid → 400 VALIDATION_ERROR with per-field details. */
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

/** Reads a `text/plain` body as JSON (the beacon sends text/plain on purpose); else unchanged. */
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
