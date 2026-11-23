'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { browserScrollEnvironment, scrollToSection } from '@/lib/section-scroll';

/**
 * A link to a home-page section that works on every click (lib/section-scroll.ts explains the
 * bug it fixes). On another page it is an ordinary link to `/#id`.
 *
 * `prefetch={false}`, like every link to the home page: it is rendered per request, so Next.js
 * would prefetch only its title, which costs an API request (the profile) whenever such a link
 * is on screen. Every page shows one in the header, so each visit to /admin added a request to
 * its own dashboard. Following the link is no slower: the page is fetched on click either way.
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
