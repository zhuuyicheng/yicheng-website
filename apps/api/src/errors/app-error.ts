import {
  errorCodeSchema,
  type ErrorCode as SharedErrorCode,
  type ValidationIssue,
} from '@portfolio/shared';

/**
 * Every error code the API can return (DESIGN.md §7.2), as `ErrorCode.NOT_FOUND` etc. The list
 * itself is part of the shared contract, so the web app knows every code it may receive.
 */
export const ErrorCode = errorCodeSchema.enum;
export type ErrorCode = SharedErrorCode;

export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** One invalid field, returned in `error.details` of a VALIDATION_ERROR. */
export type { ValidationIssue } from '@portfolio/shared';

export interface AppErrorOptions extends ErrorOptions {
  details?: ValidationIssue[];
}

/**
 * An expected, client-facing failure. Its message is returned to the caller verbatim,
 * so it must never contain internal details.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ValidationIssue[] | undefined;

  constructor(code: ErrorCode, message: string, options?: AppErrorOptions) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = HTTP_STATUS_BY_ERROR_CODE[code];
    this.details = options?.details;
  }
}
