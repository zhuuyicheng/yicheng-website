import type { ReactNode } from 'react';

/**
 * A closed-by-default "how is this counted?" note under a dashboard block. `<details>` is
 * native: it opens without JavaScript, works for keyboards and screen readers, and keeps the
 * dashboard short for the days the owner only wants the numbers.
 */
export function Explainer({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-surface px-4 py-3 text-sm sm:px-5">
      <summary className="cursor-pointer text-body marker:text-muted hover:text-brand">
        {summary}
      </summary>
      <div className="mt-3 space-y-3 leading-relaxed text-body">{children}</div>
    </details>
  );
}
