import type { LucideIcon } from 'lucide-react';

/** A section's title with its icon, on the home page and the projects page. */
export function SectionHeading({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <div className="mb-10 flex items-center gap-4 sm:mb-14">
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <h2 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}
