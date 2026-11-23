import type { AnchorHTMLAttributes, ReactNode } from 'react';

interface TrackedLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  /** Sent to the API on click, e.g. `click:linkedin-link` (DESIGN.md §7.5). */
  track: string;
  children: ReactNode;
}

/**
 * An external link (new tab) whose clicks are counted by the beacon's one listener, so it works
 * in Server Components. `noopener noreferrer`: no `window.opener`, no Referer.
 */
export function TrackedLink({ href, track, children, ...rest }: TrackedLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-track={track} {...rest}>
      {children}
    </a>
  );
}
