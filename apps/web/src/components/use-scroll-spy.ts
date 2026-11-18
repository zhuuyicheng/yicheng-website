'use client';

import { useEffect, useState } from 'react';
import { activeSection, updateVisible } from '@/lib/scroll-spy';

/**
 * The id of the section being read (inside the band `rootMargin` leaves across the screen),
 * or `null` when none is, e.g. at the top of the page. See lib/scroll-spy.ts.
 *
 * `ids` must keep its identity between renders (a module constant or a useMemo result), or the
 * observer is rebuilt on every render.
 */
export function useScrollSpy(
  ids: readonly string[],
  rootMargin: string,
  enabled = true,
): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let visible: ReadonlySet<string> = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        visible = updateVisible(
          visible,
          entries.map((entry) => ({ id: entry.target.id, isIntersecting: entry.isIntersecting })),
        );
        setActive(activeSection(visible, ids));
      },
      { rootMargin },
    );
    for (const id of ids) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => {
      observer.disconnect();
    };
  }, [ids, rootMargin, enabled]);

  return active;
}
