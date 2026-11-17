/** Every error code the API can return. See DESIGN.md §7.2. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

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
export interface ValidationIssue {
  path: string;
  message: string;
}

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
