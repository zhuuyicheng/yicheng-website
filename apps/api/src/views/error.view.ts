import type { ErrorCode, ErrorResponseBody, ValidationIssue } from '@portfolio/shared';

/** The `{ error }` envelope (DESIGN.md §7.1). */
export type { ErrorResponseBody } from '@portfolio/shared';

export function renderError(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: ValidationIssue[],
): ErrorResponseBody {
  const body: ErrorResponseBody = { error: { code, message, requestId } };
  if (details) {
    body.error.details = details;
  }
  return body;
}
