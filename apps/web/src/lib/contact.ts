import {
  contactAcceptedSchema,
  contactRequestSchema,
  errorResponseSchema,
  type ContactRequest,
} from '@portfolio/shared';

/** The contact form's logic (DESIGN.md §7.6): validate, send, and word the answer. */

export type ContactField = keyof ContactRequest;
export type FieldErrors = Partial<Record<ContactField, string>>;

/** The spam limit from the `X-RateLimit-*` headers: `limit` per `windowSeconds`. */
export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

export type ContactOutcome =
  | { kind: 'sent'; remaining: number | null; policy: RateLimitPolicy | null }
  | { kind: 'invalid'; fieldErrors: FieldErrors }
  | { kind: 'rate_limited'; retryAfterSeconds: number; policy: RateLimitPolicy | null }
  | { kind: 'failed'; message: string };

/** The API's own schema, so form and API agree. */
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

/** The API's answer → what to show (rate-limit headers are readable via CORS's expose list). */
export function interpretContactResponse(
  status: number,
  headers: Pick<Headers, 'get'>,
  body: unknown,
): ContactOutcome {
  if (status === 202 && contactAcceptedSchema.safeParse(dataOf(body)).success) {
    return {
      kind: 'sent',
      remaining: numberHeader(headers, 'x-ratelimit-remaining'),
      policy: rateLimitPolicy(headers),
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limited',
      retryAfterSeconds: numberHeader(headers, 'retry-after') ?? 60,
      policy: rateLimitPolicy(headers),
    };
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

const THANKS = 'Message sent. Thank you, I will get back to you soon.';

/** After a send: "… you can send 2 more in that time". The limit slides, hence "in that time". */
export function sentMessage(remaining: number | null, policy: RateLimitPolicy | null): string {
  if (remaining === null || policy === null) {
    return THANKS;
  }
  const rule = spamRule(policy);
  if (remaining <= 0) {
    return `${THANKS} ${rule}, and that was your last one for now.`;
  }
  return `${THANKS} ${rule}, so you can send ${String(remaining)} more in that time.`;
}

/** When the spam limit was reached. */
export function rateLimitedMessage(
  retryAfterSeconds: number,
  policy: RateLimitPolicy | null,
): string {
  const retry = `Please try again in ${formatWait(retryAfterSeconds)}.`;
  return policy === null ? `Too many messages for now. ${retry}` : `${spamRule(policy)}. ${retry}`;
}

function spamRule(policy: RateLimitPolicy): string {
  return `To keep spam out, the form accepts ${messages(policy.limit)} per person every ${formatWait(policy.windowSeconds)}`;
}

function messages(count: number): string {
  return `${String(count)} message${count === 1 ? '' : 's'}`;
}

/** `570` → `"10 minutes"`: rounded up, never too early. */
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
      errors[field] = issue.message; // the first problem per field is enough
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

function rateLimitPolicy(headers: Pick<Headers, 'get'>): RateLimitPolicy | null {
  const limit = numberHeader(headers, 'x-ratelimit-limit');
  const windowSeconds = numberHeader(headers, 'x-ratelimit-window');
  return limit === null || windowSeconds === null ? null : { limit, windowSeconds };
}

function numberHeader(headers: Pick<Headers, 'get'>, name: string): number | null {
  const value = headers.get(name);
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
