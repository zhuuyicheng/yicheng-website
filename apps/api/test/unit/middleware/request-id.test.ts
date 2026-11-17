import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { resolveRequestId } from '../../../src/middleware/request-id.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requestWithHeader(value?: string | string[]): Pick<IncomingMessage, 'headers'> {
  return { headers: value === undefined ? {} : { 'x-request-id': value } };
}

describe('resolveRequestId', () => {
  it('reuses a safe incoming id', () => {
    expect(resolveRequestId(requestWithHeader('abc-123_DEF.456:789'))).toBe('abc-123_DEF.456:789');
  });

  it('generates a UUID when the header is missing', () => {
    expect(resolveRequestId(requestWithHeader())).toMatch(UUID_PATTERN);
  });

  it.each([
    ['contains spaces', 'id with spaces'],
    ['contains markup', '<script>'],
    ['is empty', ''],
    ['is too long', 'a'.repeat(129)],
  ])('generates a UUID when the incoming id %s', (_reason, value) => {
    expect(resolveRequestId(requestWithHeader(value))).toMatch(UUID_PATTERN);
  });

  it('generates a UUID when the header is sent more than once', () => {
    expect(resolveRequestId(requestWithHeader(['a', 'b']))).toMatch(UUID_PATTERN);
  });
});
