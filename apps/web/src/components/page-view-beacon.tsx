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
  shouldRecord,
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
 * Sends a page view on every navigation, and a click for links marked `data-track` (DESIGN.md
 * §8.2). The referrer goes with the first view only. Skips the owner's browsing. Needs
 * <Suspense>: `useSearchParams` reads the URL.
 */
export function PageViewBeacon() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastSent = useRef<string | null>(null);
  const isFirstView = useRef(true);

  useEffect(() => {
    const query = searchParams.toString();
    const path = query ? `${pathname}?${query}` : pathname;
    // Strict Mode runs effects twice in development: count each page once.
    if (lastSent.current === path) {
      return;
    }
    lastSent.current = path;
    if (!shouldRecord(path, safeLocalStorage())) {
      isFirstView.current = false;
      return;
    }

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

  // One listener for every tracked link (event delegation).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLElement>('[data-track]');
      const name = link?.dataset.track;
      if (!name || !shouldRecord(window.location.pathname, safeLocalStorage())) return;
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

/** `window.sessionStorage` itself throws when storage is blocked. */
function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** `window.localStorage` itself throws when storage is blocked. */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
