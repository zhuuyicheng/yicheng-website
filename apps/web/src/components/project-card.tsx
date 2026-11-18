import type { ProjectSummary } from '@portfolio/shared';
import Link from 'next/link';

/**
 * One project as a card. The whole card opens the project's page: the title link's `::after`
 * stretches over the card, so the full box is clickable while screen readers still hear just
 * the title as the link. Hovering lifts the card; keyboard focus outlines it.
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <article className="group relative flex h-full flex-col rounded-xl border border-white/10 bg-zinc-900/40 p-6 transition duration-200 hover:-translate-y-1 hover:border-emerald-400/50 hover:bg-zinc-900/70 active:translate-y-0 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-emerald-400/70 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-medium text-zinc-100">
          <Link
            href={`/projects/${project.slug}`}
            className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
          >
            {project.title}
          </Link>
        </h3>
        {project.featured && (
          <span className="shrink-0 rounded border border-emerald-400/30 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-emerald-300 uppercase">
            Featured
          </span>
        )}
      </div>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-400">{project.summary}</p>

      <ul className="mt-5 flex flex-wrap gap-1.5" aria-label="Technologies">
        {project.techStack.map((tech) => (
          <li key={tech} className="rounded bg-white/5 px-2 py-0.5 text-xs text-zinc-300">
            {tech}
          </li>
        ))}
      </ul>

      <p
        aria-hidden
        className="mt-6 flex items-center gap-1.5 text-sm font-medium text-emerald-300"
      >
        Read more
        <span className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none">
          →
        </span>
      </p>
    </article>
  );
}
