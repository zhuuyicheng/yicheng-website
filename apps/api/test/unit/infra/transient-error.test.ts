import { describe, expect, it } from 'vitest';
import { isTransientDatastoreError } from '../../../src/infra/transient-error.js';

/** Builds an error the way pg / Node attach codes: an Error with an extra `code` property. */
function errorWithCode(code: string, message = 'boom'): Error {
  return Object.assign(new Error(message), { code });
}

describe('isTransientDatastoreError', () => {
  it.each([
    ['ECONNREFUSED', 'nothing listening'],
    ['ECONNRESET', 'connection dropped'],
    ['ENOTFOUND', 'DNS name not resolvable yet'],
  ])('treats network code %s (%s) as transient', (code) => {
    expect(isTransientDatastoreError(errorWithCode(code))).toBe(true);
  });

  it.each([
    ['08006', 'connection failure'],
    ['53300', 'too many connections'],
    ['57P01', 'admin shutdown'],
    ['57P03', 'cannot connect now (starting up)'],
    ['40001', 'serialization failure'],
    ['40P01', 'deadlock'],
  ])('treats SQLSTATE %s (%s) as transient', (code) => {
    expect(isTransientDatastoreError(errorWithCode(code))).toBe(true);
  });

  it.each([
    ['22P02', 'invalid input syntax'],
    ['23502', 'not-null violation'],
    ['23505', 'unique violation'],
    ['42P01', 'undefined table (a bug, not an outage)'],
  ])('treats SQLSTATE %s (%s) as permanent', (code) => {
    expect(isTransientDatastoreError(errorWithCode(code))).toBe(false);
  });

  it.each([
    'Connection terminated unexpectedly',
    'timeout exceeded when trying to connect',
    'Client has encountered a connection error and is not queryable',
    'Connection is closed.',
    "Stream isn't writeable and enableOfflineQueue options is false",
    "OOM command not allowed when used memory > 'maxmemory'.",
    'LOADING Redis is loading the dataset in memory',
  ])('recognises the code-less library error "%s"', (message) => {
    expect(isTransientDatastoreError(new Error(message))).toBe(true);
  });

  it('does not confuse a similar-looking permanent Redis error', () => {
    expect(isTransientDatastoreError(new Error('BUSYGROUP Consumer Group already exists'))).toBe(
      false,
    );
  });

  it('treats ordinary errors and non-errors as permanent', () => {
    expect(isTransientDatastoreError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isTransientDatastoreError('ECONNREFUSED')).toBe(false);
    expect(isTransientDatastoreError(null)).toBe(false);
  });

  it('looks through a `cause` chain and inside AggregateError', () => {
    const wrapped = new Error('loading profile failed', { cause: errorWithCode('ECONNREFUSED') });
    const aggregate = new AggregateError(
      [new Error('x'), errorWithCode('ETIMEDOUT')],
      'all failed',
    );

    expect(isTransientDatastoreError(wrapped)).toBe(true);
    expect(isTransientDatastoreError(aggregate)).toBe(true);
  });

  it('survives a cyclic cause', () => {
    const error: Error & { cause?: unknown } = new Error('loop');
    error.cause = error;

    expect(isTransientDatastoreError(error)).toBe(false);
  });
});
