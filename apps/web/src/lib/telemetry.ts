import { EVENT_LIMITS, eventRequestSchema, type EventRequest } from '@portfolio/shared';

/**
 * The page-view beacon's logic (DESIGN.md §7.5, §8.2): build the events the browser sends to
 * POST /api/v1/events. Kept free of React and of global browser objects (they are passed in),
 * so it can be unit-tested.
 */

export const SESSION_STORAGE_KEY = 'portfolio.sessionId';

/** 16 URL-safe characters from 12 random bytes: unguessable, and matches the API's rule. */
export function newSessionId(randomBytes: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = randomBytes(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

/**
 * One id per browser tab: sessionStorage survives reloads and navigation but not closing the
 * tab, and it is never sent to any server by itself (unlike a cookie). Storage can be
 * unavailable (strict privacy modes), so failures fall back to an id for this page load.
 */
export function getSessionId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  randomBytes: (bytes: Uint8Array) => Uint8Array,
): string {
  try {
    const existing = storage?.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const created = newSessionId(randomBytes);
    storage?.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return newSessionId(randomBytes); // storage refused: still count the visit
  }
}

/**
 * The site the visitor came from, or `null` for none, our own site, or anything odd. Browsers
 * keep `document.referrer` at the original value during in-app navigation, so the beacon sends
 * it with the first page view only (see page-view-beacon.tsx).
 */
export function externalReferrer(referrer: string, ownOrigin: string): string | null {
  try {
    const url = new URL(referrer);
    const isWeb = url.protocol === 'https:' || url.protocol === 'http:';
    if (!isWeb || url.origin === ownOrigin || referrer.length > EVENT_LIMITS.referrer) {
      return null;
    }
    return referrer;
  } catch {
    return null; // empty string (no referrer) or not a URL
  }
}

interface PageViewInput {
  /** Pathname plus query string, e.g. `/?ref=acme`: the API keeps `ref` and `utm_*` from it. */
  path: string;
  referrer: string | null;
  sessionId: string;
  timezone: string | null;
}

/**
 * A page view the API will accept, or `null`. Validated with the API's own schema first: an
 * event the API would refuse is better fixed (or dropped) here than sent for nothing.
 */
export function buildPageView(input: PageViewInput): EventRequest | null {
  const event = {
    type: 'page_view' as const,
    path: input.path.slice(0, EVENT_LIMITS.path),
    referrer: input.referrer,
    sessionId: input.sessionId,
    timezone: input.timezone,
  };
  return validOrWithoutTimezone(event);
}

/** `GitHub` → `click:github-link`: an interaction name the API accepts (lowercase, ≤ 64). */
export function trackName(label: string, kind = 'link'): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `click:${slug || 'external'}-${kind}`;
}

/** A click worth knowing about, e.g. `click:github-link`. `null` if the name is not allowed. */
export function buildInteraction(
  name: string,
  input: Omit<PageViewInput, 'referrer'>,
): EventRequest | null {
  const event = {
    type: 'interaction' as const,
    name,
    path: input.path.slice(0, EVENT_LIMITS.path),
    sessionId: input.sessionId,
    timezone: input.timezone,
  };
  return validOrWithoutTimezone(event);
}

/** An unusual time zone name should cost the time zone, not the whole event. */
function validOrWithoutTimezone(event: Record<string, unknown>): EventRequest | null {
  const parsed = eventRequestSchema.safeParse(event);
  if (parsed.success) {
    return parsed.data;
  }
  const retried = eventRequestSchema.safeParse({ ...event, timezone: null });
  return retried.success ? retried.data : null;
}

/**
 * Sends an event without waiting for, or caring about, the answer.
 *
 *   - `text/plain`, though the body is JSON: for the browser that makes this a "simple"
 *     cross-origin request, sent straight away. `application/json` would first need a CORS
 *     preflight (an extra OPTIONS round trip), which some browsers do not combine with
 *     `keepalive`. The API reads either (apps/api/src/controllers/events.controller.ts).
 *   - `keepalive`: the request finishes even if the visitor is already leaving the page
 *     (e.g. clicking an external link).
 *
 * Analytics must never break the site, so failures are ignored here on purpose: the API counts
 * what arrives, and its own metrics show refusals (DESIGN.md §8.5).
 */
export function sendEvent(
  event: EventRequest,
  options: { baseUrl: string; fetch: typeof globalThis.fetch },
): void {
  options
    .fetch(`${options.baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(event),
      keepalive: true,
    })
    .catch(() => undefined); // offline, blocked by an extension, API down: nothing to do
}
