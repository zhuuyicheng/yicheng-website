import type { AnchorHTMLAttributes, ReactNode } from 'react';

interface TrackedLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  /** Interaction name sent to the API on click, e.g. `click:github-link` (DESIGN.md §7.5). */
  track: string;
  children: ReactNode;
}

/**
 * A link to another site, opened in a new tab, whose clicks are counted. Works in Server
 * Components: the click itself is caught by the page-view beacon's single listener.
 *
 * `rel="noopener noreferrer"`: the other site gets no handle on this tab (`window.opener`),
 * and no Referer header.
 */
export function TrackedLink({ href, track, children, ...rest }: TrackedLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-track={track} {...rest}>
      {children}
    </a>
  );
}
