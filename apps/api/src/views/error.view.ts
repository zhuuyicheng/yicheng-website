import type { ErrorCode, ErrorResponseBody, ValidationIssue } from '@portfolio/shared';

/** The one error response shape every endpoint uses (DESIGN.md §7.1), from the shared contract. */
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
