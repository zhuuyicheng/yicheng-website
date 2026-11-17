import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError, ErrorCode } from '../../../src/errors/app-error.js';
import {
  GENERIC_ERROR_MESSAGE,
  registerErrorHandlers,
  toErrorResponse,
} from '../../../src/middleware/error-handler.js';
import type { ErrorResponseBody } from '../../../src/views/error.view.js';

describe('toErrorResponse', () => {
  it('maps an AppError to its own status, code and message', () => {
    const error = new AppError(ErrorCode.RATE_LIMITED, 'Too many requests');

    expect(toErrorResponse(error, 'req-1')).toEqual({
      statusCode: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: 'req-1' } },
    });
  });

  it('maps schema validation failures to VALIDATION_ERROR with field details', () => {
    const error = Object.assign(new Error('body/email must match format "email"'), {
      validation: [{ instancePath: '/contact/email', message: 'must match format "email"' }],
    });

    const { statusCode, body } = toErrorResponse(error, 'req-2');

    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([
      { path: 'contact.email', message: 'must match format "email"' },
    ]);
  });

  it('hides the message of unexpected errors', () => {
    const { statusCode, body } = toErrorResponse(new Error('connection to 10.0.0.5 lost'), 'r3');

    expect(statusCode).toBe(500);
    expect(body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: GENERIC_ERROR_MESSAGE,
      requestId: 'r3',
    });
  });

  it('treats a 5xx statusCode on an unknown error as internal', () => {
    const error = Object.assign(new Error('upstream exploded'), { statusCode: 502 });

    expect(toErrorResponse(error, 'r4').body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('registered error handlers', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false, bodyLimit: 32 });
    registerErrorHandlers(app);
    app.get('/boom', () => {
      throw new Error('secret internal detail');
    });
    app.post('/echo', (request) => request.body);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the envelope for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponseBody>().error.code).toBe('NOT_FOUND');
  });

  it('never leaks internal error messages', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret internal detail');
  });

  it('maps malformed JSON to BAD_REQUEST', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"unterminated": ',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponseBody>().error.code).toBe('BAD_REQUEST');
  });

  it('maps oversized bodies to PAYLOAD_TOO_LARGE', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { text: 'x'.repeat(100) },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json<ErrorResponseBody>().error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
