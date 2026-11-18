import { describe, expect, it } from 'vitest';
import { jsonFromText, parseRequest } from '../../../src/controllers/parse-request.js';
import { AppError } from '../../../src/errors/app-error.js';
import { projectParamsSchema } from '../../../src/schema/content.schema.js';

describe('parseRequest', () => {
  it('returns the parsed value when the input is valid', () => {
    expect(parseRequest(projectParamsSchema, { slug: 'note-g' })).toEqual({ slug: 'note-g' });
  });

  it('throws a VALIDATION_ERROR AppError with one detail per invalid field', () => {
    let caught: unknown;
    try {
      parseRequest(projectParamsSchema, { slug: 'Not_A_Slug' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    const appError = caught as AppError;
    expect(appError.code).toBe('VALIDATION_ERROR');
    expect(appError.statusCode).toBe(400);
    expect(appError.details).toEqual([
      { path: 'slug', message: 'must be lowercase letters/digits separated by hyphens' },
    ]);
  });
});

describe('jsonFromText', () => {
  it('reads a text/plain body as JSON, and leaves an already parsed body alone', () => {
    expect(jsonFromText('{"type":"page_view"}')).toEqual({ type: 'page_view' });
    expect(jsonFromText({ type: 'page_view' })).toEqual({ type: 'page_view' });
  });

  it('turns text that is not JSON into a 400 BAD_REQUEST', () => {
    expect(() => jsonFromText('not json')).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST', statusCode: 400 }),
    );
  });
});
