import { formatDay } from '@/lib/format';

/**
 * "Last updated 21 November 2026", the last line of a page's content (DESIGN.md §8.6). The
 * API moves these dates only when the seed really changes something, so a deploy that leaves
 * the content alone keeps them.
 */
export function LastUpdated({ at, className }: { at: string; className?: string }) {
  return (
    <p className={`text-sm text-muted ${className ?? ''}`}>
      Last updated <time dateTime={at}>{formatDay(at)}</time>
    </p>
  );
}
