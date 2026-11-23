import { formatDay } from '@/lib/format';

/** "Last updated 21 November 2026" (DESIGN.md §8.6). Moves only when the seed changes something. */
export function LastUpdated({ at, className }: { at: string; className?: string }) {
  return (
    <p className={`text-sm text-muted ${className ?? ''}`}>
      Last updated <time dateTime={at}>{formatDay(at)}</time>
    </p>
  );
}
