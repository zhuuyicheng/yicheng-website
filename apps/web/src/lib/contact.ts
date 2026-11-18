import {
  contactAcceptedSchema,
  contactRequestSchema,
  errorResponseSchema,
  type ContactRequest,
} from '@portfolio/shared';

/**
 * The contact form's logic (DESIGN.md §7.6): validate, send, and turn the API's answer into
 * something the form can show. No React here, so every answer can be unit-tested.
 */

export type ContactField = keyof ContactRequest;
export type FieldErrors = Partial<Record<ContactField, string>>;

export type ContactOutcome =
  | { kind: 'sent'; remaining: number | null }
  | { kind: 'invalid'; fieldErrors: FieldErrors }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'failed'; message: string };

/** The same schema the API uses, so the form and the API always agree on what is valid. */
export function validateContact(
  input: Record<ContactField, string>,
): { ok: true; request: ContactRequest } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = contactRequestSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, request: parsed.data };
  }
  return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
}

export async function sendContact(
  request: ContactRequest,
  options: { baseUrl: string; fetch: typeof globalThis.fetch },
): Promise<ContactOutcome> {
  let response: Response;
  try {
    response = await options.fetch(`${options.baseUrl}/api/v1/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    return { kind: 'failed', message: 'Could not reach the server. Check your connection.' };
  }
  const body: unknown = await response.json().catch(() => null);
  return interpretContactResponse(response.status, response.headers, body);
}

/**
 * The API's answer → what to show. The rate-limit headers are readable here only because the
 * API lists them in `Access-Control-Expose-Headers` (apps/api/src/middleware/security.ts).
 */
export function interpretContactResponse(
  status: number,
  headers: Pick<Headers, 'get'>,
  body: unknown,
): ContactOutcome {
  if (status === 202 && contactAcceptedSchema.safeParse(dataOf(body)).success) {
    return { kind: 'sent', remaining: numberHeader(headers, 'x-ratelimit-remaining') };
  }
  if (status === 429) {
    return { kind: 'rate_limited', retryAfterSeconds: numberHeader(headers, 'retry-after') ?? 60 };
  }
  const error = errorResponseSchema.safeParse(body);
  if (status === 400 && error.success && error.data.error.details) {
    return { kind: 'invalid', fieldErrors: toFieldErrors(error.data.error.details) };
  }
  if (status === 503) {
    return { kind: 'failed', message: 'The server is busy right now. Please try again shortly.' };
  }
  return { kind: 'failed', message: 'Something went wrong. Please try again later.' };
}

/** `570` → `"10 minutes"`, `45` → `"45 seconds"`: always rounded up, never too early. */
export function formatWait(seconds: number): string {
  if (seconds < 60) {
    const s = Math.max(1, Math.ceil(seconds));
    return `${String(s)} second${s === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
}

function toFieldErrors(issues: readonly { path: PropertyKey[] | string; message: string }[]) {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = String(Array.isArray(issue.path) ? (issue.path[0] ?? '') : issue.path);
    if (isContactField(field) && errors[field] === undefined) {
      errors[field] = issue.message; // first problem per field is enough
    }
  }
  return errors;
}

function isContactField(field: string): field is ContactField {
  return field === 'name' || field === 'email' || field === 'message';
}

function dataOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'data' in body ? body.data : undefined;
}

function numberHeader(headers: Pick<Headers, 'get'>, name: string): number | null {
  const value = headers.get(name);
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
