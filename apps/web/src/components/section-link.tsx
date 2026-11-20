'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { browserScrollEnvironment, scrollToSection } from '@/lib/section-scroll';

/**
 * A link to a home-page section that works on every click (lib/section-scroll.ts explains the
 * bug it fixes). On another page it is an ordinary link to `/#id`.
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
      className={props.className}
      onClick={(event) => {
        props.onNavigate?.();
        // Modified clicks (new tab, new window) keep their usual meaning.
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
