'use client';

import type { ProjectSummary } from '@portfolio/shared';
import { useMemo, useState } from 'react';
import { ProjectCard } from './project-card';
import { Reveal } from './reveal';

/** Every technology used, most common first (ties alphabetically). */
function technologies(projects: readonly ProjectSummary[]): string[] {
  const uses = new Map<string, number>();
  for (const tech of projects.flatMap((project) => project.techStack)) {
    uses.set(tech, (uses.get(tech) ?? 0) + 1);
  }
  return [...uses.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tech]) => tech);
}

/** Project grid with a technology filter: tap a chip to see only the projects that use it. */
export function ProjectExplorer({ projects }: { projects: ProjectSummary[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const allTech = useMemo(() => technologies(projects), [projects]);
  const shown =
    selected === null ? projects : projects.filter((p) => p.techStack.includes(selected));

  const chip = (label: string, value: string | null) => {
    const active = selected === value;
    return (
      <button
        key={label}
        type="button"
        aria-pressed={active}
        onClick={() => {
          setSelected(active ? null : value);
        }}
        className={`rounded-full border px-3 py-1 font-mono text-xs transition ${
          active
            ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
            : 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Filter by technology">
        {chip('all', null)}
        {allTech.map((tech) => chip(tech, tech))}
      </div>

      <p className="sr-only" aria-live="polite">
        {`${String(shown.length)} project${shown.length === 1 ? '' : 's'} shown`}
      </p>

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((project, index) => (
          <li key={project.slug}>
            <Reveal delayMs={index * 80} className="h-full">
              <ProjectCard project={project} />
            </Reveal>
          </li>
        ))}
      </ul>
    </div>
  );
}
