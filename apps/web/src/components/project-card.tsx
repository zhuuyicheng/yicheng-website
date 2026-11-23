import type { ProjectSummary } from '@portfolio/shared';
import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

/**
 * One project as a card. The whole card opens the project's page: the title link's `::after`
 * stretches over the card, so the full box is clickable while screen readers still hear just
 * the title as the link. Hovering lifts the card; keyboard focus outlines it.
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-line bg-surface p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-brand/50 hover:shadow-lg active:translate-y-0 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-brand/70 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-display text-xl font-semibold text-ink">
          <Link
            href={`/${project.slug}`}
            prefetch={false} // why: section-link.tsx
            className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
          >
            {project.title}
          </Link>
        </h3>
        {project.featured && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
            <Sparkles aria-hidden className="size-3" />
            Featured
          </span>
        )}
      </div>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{project.summary}</p>

      <ul className="mt-5 flex flex-wrap gap-1.5" aria-label="Technologies">
        {project.techStack.map((tech) => (
          <li key={tech} className="rounded-full bg-sunken px-2.5 py-0.5 text-xs text-body">
            {tech}
          </li>
        ))}
      </ul>

      <p aria-hidden className="mt-6 flex items-center gap-1.5 text-sm font-medium text-brand">
        Read more
        <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" />
      </p>
    </article>
  );
}
