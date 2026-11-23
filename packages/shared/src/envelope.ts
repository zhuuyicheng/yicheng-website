import { z } from 'zod';

/** Every `/api/v1` response is `{ data }` or `{ error: { code, message, requestId } }`. */

/** Every error code the API can return, with its HTTP status in DESIGN.md §7.2. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** One invalid field of a VALIDATION_ERROR, e.g. `{ path: "email", message: "…" }`. */
export const validationIssueSchema = z.object({ path: z.string(), message: z.string() });
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.array(validationIssueSchema).optional(),
  }),
});
export type ErrorResponseBody = z.infer<typeof errorResponseSchema>;

/** The `{ data }` envelope around `payload`. */
export function dataResponseSchema<T extends z.ZodType>(payload: T) {
  return z.object({ data: payload });
}

export interface DataResponseBody<T> {
  data: T;
}
