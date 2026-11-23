'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { browserScrollEnvironment, scrollToSection } from '@/lib/section-scroll';

/**
 * A link to a home-page section that works on every click (lib/section-scroll.ts).
 * `prefetch={false}`, like every link to the home page or a project: those pages render per
 * request, so a prefetch fetches their title, an API request /admin counts though nobody
 * clicked. The click is no slower. ESLint makes every `<Link>` choose.
 */
export function SectionLink(props: {
  id: string;
  className?: string;
  children: ReactNode;
  /** E.g. close the mobile menu. */
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={`/#${props.id}`}
      prefetch={false}
      className={props.className}
      onClick={(event) => {
        props.onNavigate?.();
        // Modified clicks (new tab, window) keep their meaning.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (scrollToSection(props.id, browserScrollEnvironment())) {
          event.preventDefault();
        }
      }}
    >
      {props.children}
    </Link>
  );
}
