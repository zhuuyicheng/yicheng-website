'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { PUBLIC_API_BASE_URL } from '@/lib/config';
import {
  buildInteraction,
  buildPageView,
  externalReferrer,
  getSessionId,
  sendEvent,
} from '@/lib/telemetry';

/** `crypto.getRandomValues`, typed to what newSessionId expects. */
const randomBytes = (bytes: Uint8Array) => crypto.getRandomValues(bytes);

function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Sends a page view to the API on every navigation, and an interaction for clicks on links
 * marked `data-track="click:…"` (see tracked-link.tsx). Renders nothing. DESIGN.md §8.2.
 *
 * The path includes the query string, so a tagged link (`/?ref=acme`) is recorded as such.
 * The referrer goes with the first page view only: afterwards the visitor came from our own
 * pages, which says nothing new.
 *
 * Must sit inside <Suspense> (app/layout.tsx): `useSearchParams` reads the URL, which is only
 * known in the browser for pages Next.js renders ahead of time.
 */
export function PageViewBeacon() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastSent = useRef<string | null>(null);
  const isFirstView = useRef(true);

  useEffect(() => {
    const query = searchParams.toString();
    const path = query ? `${pathname}?${query}` : pathname;
    // React runs effects twice in development (Strict Mode): count each page once.
    if (lastSent.current === path) {
      return;
    }
    lastSent.current = path;

    const event = buildPageView({
      path,
      referrer: isFirstView.current
        ? externalReferrer(document.referrer, window.location.origin)
        : null,
      sessionId: getSessionId(safeSessionStorage(), randomBytes),
      timezone: browserTimezone(),
    });
    isFirstView.current = false;
    if (event) {
      sendEvent(event, { baseUrl: PUBLIC_API_BASE_URL, fetch: window.fetch.bind(window) });
    }
  }, [pathname, searchParams]);

  // One listener for every tracked link on every page ("event delegation").
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLElement>('[data-track]');
      const name = link?.dataset.track;
      if (!name) return;
      const interaction = buildInteraction(name, {
        path: window.location.pathname,
        sessionId: getSessionId(safeSessionStorage(), randomBytes),
        timezone: browserTimezone(),
      });
      if (interaction) {
        sendEvent(interaction, { baseUrl: PUBLIC_API_BASE_URL, fetch: window.fetch.bind(window) });
      }
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
    };
  }, []);

  return null;
}

/** Reading `window.sessionStorage` itself throws when storage is blocked. */
function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
