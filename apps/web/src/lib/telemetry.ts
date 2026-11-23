import { EVENT_LIMITS, eventRequestSchema, type EventRequest } from '@portfolio/shared';

/** The page-view beacon's logic (DESIGN.md §7.5): builds events. Browser objects are passed in. */

export const SESSION_STORAGE_KEY = 'portfolio.sessionId';

/** 16 URL-safe characters from 12 random bytes: unguessable, and the API accepts it. */
export function newSessionId(randomBytes: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = randomBytes(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

/**
 * One id per tab: sessionStorage survives reloads but not closing the tab, and is never sent by
 * itself (unlike a cookie). Without storage (strict privacy), an id for this page load.
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
 * The referring site, or `null` (none, our own, odd). `document.referrer` stays the same during
 * in-app navigation, so the beacon sends it with the first page view only.
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
  /** Path plus query string (`/?ref=acme`): the API reads `ref` and `utm_*` from it. */
  path: string;
  referrer: string | null;
  sessionId: string;
  timezone: string | null;
}

/** Marks a browser as the owner's (set from /admin). */
export const OWNER_BROWSER_KEY = 'portfolio.ownerBrowser';

/** Not the owner's browsing: /admin, or any page in a browser marked as theirs. */
export function shouldRecord(path: string, storage: Pick<Storage, 'getItem'> | null): boolean {
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/admin?')) {
    return false;
  }
  try {
    return storage?.getItem(OWNER_BROWSER_KEY) !== '1';
  } catch {
    return true; // storage blocked: nothing marks this browser as the owner's
  }
}

/** A page view the API will accept, or `null`: checked with the API's schema before sending. */
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

/** `LinkedIn` → `click:linkedin-link` (lowercase, ≤ 64). */
export function trackName(label: string, kind = 'link'): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `click:${slug || 'external'}-${kind}`;
}

/** A tracked click, or `null` if the name isn't allowed. */
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

/** An odd time zone name should cost the time zone, not the event. */
function validOrWithoutTimezone(event: Record<string, unknown>): EventRequest | null {
  const parsed = eventRequestSchema.safeParse(event);
  if (parsed.success) {
    return parsed.data;
  }
  const retried = eventRequestSchema.safeParse({ ...event, timezone: null });
  return retried.success ? retried.data : null;
}

/**
 * Fire and forget. `text/plain` (though JSON) avoids a CORS preflight, which some browsers
 * won't combine with `keepalive`; `keepalive` lets it finish as the visitor leaves. Failures
 * are ignored: analytics must never break the site.
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
    .catch(() => undefined); // offline, blocked, API down: nothing to do
}
