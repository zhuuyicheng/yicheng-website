import type { VisitorSummary } from '@portfolio/shared';
import { countOf } from '@/lib/format';

/**
 * Below "Pages": addresses that showed "Page not found" (a typo, an old or broken link), folded
 * away so they don't crowd the site's real pages (DESIGN.md §8.7). Opens without JavaScript.
 */
export function MissingPages({ pages }: { pages: VisitorSummary['missingPages'] }) {
  if (pages.length === 0) return null;
  return (
    <details className="mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer text-xs text-muted marker:text-muted hover:text-brand">
        Pages that don&apos;t exist: {countOf(pages.length, 'address', 'addresses')}
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Addresses that showed &ldquo;Page not found&rdquo;: a typo, or a link that is broken or out
        of date. One that keeps coming back may be a link you shared somewhere.
      </p>
      <ul className="mt-2 space-y-1.5">
        {pages.map((page) => (
          <li key={page.path} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-mono text-body" title={page.path}>
              {page.path}
            </span>
            <span className="shrink-0 text-muted tabular-nums">
              {countOf(page.views, 'view')} · {countOf(page.visits, 'visit')}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
