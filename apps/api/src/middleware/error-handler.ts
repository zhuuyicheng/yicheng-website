import type { FastifyInstance } from 'fastify';
import { AppError, ErrorCode } from '../errors/app-error.js';
import { renderError, type ErrorResponseBody, type ValidationIssue } from '../views/error.view.js';

export const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred';

export interface ErrorResponse {
  statusCode: number;
  body: ErrorResponseBody;
}

/** Installs the error and 404 handlers so every failure uses the same envelope. */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = toErrorResponse(error, request.id);

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.info({ code: body.error.code, reason: body.error.message }, 'request rejected');
    }

    return reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body = renderError(
      ErrorCode.NOT_FOUND,
      `Route ${request.method} ${request.url} not found`,
      request.id,
    );
    return reply.status(404).send(body);
  });
}

/** Maps any thrown value to a status code and a safe, client-facing error body. */
export function toErrorResponse(error: unknown, requestId: string): ErrorResponse {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: renderError(error.code, error.message, requestId),
    };
  }

  const validationIssues = getValidationIssues(error);
  if (validationIssues) {
    return {
      statusCode: 400,
      body: renderError(
        ErrorCode.VALIDATION_ERROR,
        'Request validation failed',
        requestId,
        validationIssues,
      ),
    };
  }

  // Fastify's own client errors (malformed JSON, body too large, ...) carry a 4xx
  // statusCode and a message that is safe to show.
  const clientStatus = getClientErrorStatus(error);
  if (clientStatus !== undefined && error instanceof Error) {
    return {
      statusCode: clientStatus,
      body: renderError(errorCodeForClientStatus(clientStatus), error.message, requestId),
    };
  }

  return {
    statusCode: 500,
    body: renderError(ErrorCode.INTERNAL_ERROR, GENERIC_ERROR_MESSAGE, requestId),
  };
}

/** Fastify attaches schema validation failures as `error.validation`. */
function getValidationIssues(error: unknown): ValidationIssue[] | undefined {
  if (!isObject(error) || !Array.isArray(error.validation)) {
    return undefined;
  }

  return error.validation.map((issue: unknown) => {
    const path =
      isObject(issue) && typeof issue.instancePath === 'string' ? issue.instancePath : '';
    const message =
      isObject(issue) && typeof issue.message === 'string' ? issue.message : 'is invalid';
    // "/email" → "email", "/items/0/name" → "items.0.name"
    return { path: path.replace(/^\//, '').replaceAll('/', '.'), message };
  });
}

function getClientErrorStatus(error: unknown): number | undefined {
  if (!isObject(error) || typeof error.statusCode !== 'number') {
    return undefined;
  }
  const status = error.statusCode;
  return status >= 400 && status < 500 ? status : undefined;
}

function errorCodeForClientStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 413:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case 415:
      return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      return ErrorCode.BAD_REQUEST;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
