import type { ErrorCode } from '../errors/app-error.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** The single error response shape used by every endpoint. See DESIGN.md §7.1. */
export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: ValidationIssue[];
  };
}

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
