import { describe, expect, it, vi } from 'vitest';
import {
  formatWait,
  interpretContactResponse,
  rateLimitedMessage,
  sendContact,
  sentMessage,
  validateContact,
} from '@/lib/contact';

const headers = (values: Record<string, string> = {}) => new Headers(values);

describe('validateContact (the API schema, in the browser)', () => {
  it('accepts and trims a valid message', () => {
    expect(validateContact({ name: ' Ada ', email: 'ada@example.com ', message: 'Hi' })).toEqual({
      ok: true,
      request: { name: 'Ada', email: 'ada@example.com', message: 'Hi' },
    });
  });

  it('reports one problem per field', () => {
    expect(validateContact({ name: '', email: 'nope', message: '   ' })).toEqual({
      ok: false,
      fieldErrors: {
        name: 'is required',
        email: 'must be a valid email address',
        message: 'is required',
      },
    });
  });
});

describe('interpretContactResponse', () => {
  it('202: sent, with how many messages are left and the limit they count against', () => {
    const body = { data: { id: 'abc', status: 'PENDING' } };
    const limits = { 'x-ratelimit-limit': '3', 'x-ratelimit-window': '600' };

    expect(
      interpretContactResponse(202, headers({ ...limits, 'x-ratelimit-remaining': '2' }), body),
    ).toEqual({ kind: 'sent', remaining: 2, policy: { limit: 3, windowSeconds: 600 } });
    expect(interpretContactResponse(202, headers(), body)).toEqual({
      kind: 'sent',
      remaining: null,
      policy: null,
    });
  });

  it('429: rate limited, with the wait from Retry-After', () => {
    const body = { error: { code: 'RATE_LIMITED', message: 'Too many', requestId: 'r1' } };

    expect(interpretContactResponse(429, headers({ 'retry-after': '540' }), body)).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 540,
      policy: null,
    });
  });

  it('400: the API’s field details, mapped to the form fields', () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId: 'r1',
        details: [{ path: 'email', message: 'must be a valid email address' }],
      },
    };

    expect(interpretContactResponse(400, headers(), body)).toEqual({
      kind: 'invalid',
      fieldErrors: { email: 'must be a valid email address' },
    });
  });

  it('503 and anything unexpected: a failure message, never a crash', () => {
    expect(interpretContactResponse(503, headers(), null)).toMatchObject({ kind: 'failed' });
    expect(interpretContactResponse(500, headers(), 'not json')).toMatchObject({ kind: 'failed' });
    expect(interpretContactResponse(202, headers(), { data: 'garbage' })).toMatchObject({
      kind: 'failed',
    });
  });
});

describe('sendContact', () => {
  it('reports a network failure instead of throwing', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    const outcome = await sendContact(
      { name: 'Ada', email: 'ada@example.com', message: 'Hi' },
      { baseUrl: 'http://api.test', fetch },
    );

    expect(outcome).toEqual({
      kind: 'failed',
      message: 'Could not reach the server. Check your connection.',
    });
  });
});

describe('formatWait', () => {
  it('rounds up, so the visitor never retries too early', () => {
    expect(formatWait(0.2)).toBe('1 second');
    expect(formatWait(45)).toBe('45 seconds');
    expect(formatWait(61)).toBe('2 minutes');
    expect(formatWait(570)).toBe('10 minutes');
  });
});

describe('what the form says about the spam limit', () => {
  const policy = { limit: 3, windowSeconds: 600 };

  it('explains the limit and how many messages are left', () => {
    expect(sentMessage(2, policy)).toBe(
      'Message sent. Thank you, I will get back to you soon. To keep spam out, the form accepts 3 messages per person every 10 minutes, so you can send 2 more in that time.',
    );
    expect(sentMessage(0, policy)).toContain('and that was your last one for now.');
  });

  it('just says thank you when the limit is unknown', () => {
    expect(sentMessage(null, policy)).toBe('Message sent. Thank you, I will get back to you soon.');
    expect(sentMessage(2, null)).toBe('Message sent. Thank you, I will get back to you soon.');
  });

  it('says why a message was refused and when to try again', () => {
    expect(rateLimitedMessage(540, policy)).toBe(
      'To keep spam out, the form accepts 3 messages per person every 10 minutes. Please try again in 9 minutes.',
    );
    expect(rateLimitedMessage(30, null)).toBe(
      'Too many messages for now. Please try again in 30 seconds.',
    );
  });
});
