'use client';

import type { ProjectSummary } from '@portfolio/shared';
import Link from 'next/link';
import type { PointerEvent } from 'react';
import { trackName } from '@/lib/telemetry';
import { TrackedLink } from './tracked-link';

/** Moves the card's glow to where the pointer is (CSS reads --mx/--my). */
function followPointer(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--mx', `${String(event.clientX - rect.left)}px`);
  event.currentTarget.style.setProperty('--my', `${String(event.clientY - rect.top)}px`);
}

/** One project: title (to its page), summary, stack, links. Glows where the pointer is. */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <article
      onPointerMove={followPointer}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900/40 p-6 transition-colors hover:border-emerald-400/40"
    >
      <div
        aria-hidden
        className="spotlight pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="relative flex items-start justify-between gap-4">
        <h3 className="text-lg font-medium text-zinc-100">
          <Link href={`/projects/${project.slug}`} className="after:absolute after:inset-0">
            {project.title}
          </Link>
        </h3>
        {project.featured && (
          <span className="shrink-0 rounded border border-emerald-400/30 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-emerald-300 uppercase">
            featured
          </span>
        )}
      </div>

      <p className="relative mt-3 flex-1 text-sm leading-relaxed text-zinc-400">
        {project.summary}
      </p>

      <ul className="relative mt-5 flex flex-wrap gap-1.5" aria-label="Technologies">
        {project.techStack.map((tech) => (
          <li
            key={tech}
            className="rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-300"
          >
            {tech}
          </li>
        ))}
      </ul>

      {(project.repoUrl !== null || project.liveUrl !== null) && (
        // `relative z-10`: above the title link's full-card click area.
        <div className="relative z-10 mt-5 flex gap-4 font-mono text-xs">
          {project.repoUrl !== null && (
            <TrackedLink
              href={project.repoUrl}
              track={trackName(project.slug, 'repo')}
              className="text-zinc-400 hover:text-emerald-300"
            >
              source ↗
            </TrackedLink>
          )}
          {project.liveUrl !== null && (
            <TrackedLink
              href={project.liveUrl}
              track={trackName(project.slug, 'live')}
              className="text-zinc-400 hover:text-emerald-300"
            >
              live ↗
            </TrackedLink>
          )}
        </div>
      )}
    </article>
  );
}
