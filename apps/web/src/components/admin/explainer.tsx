import type { ReactNode } from 'react';

/** A closed "how is this counted?" note. Native `<details>`: no JavaScript, keyboard-friendly. */
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
