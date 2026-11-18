import type { Metadata } from 'next';
import { ProjectExplorer } from '@/components/project-explorer';
import { SectionHeading } from '@/components/section-heading';
import { getProjects } from '@/lib/api';

export const metadata: Metadata = { title: 'Projects' };

/** Every project, with the technology filter. */
export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <SectionHeading title="Projects" />
      {projects.length === 0 ? (
        <p className="text-sm text-zinc-500">No projects yet.</p>
      ) : (
        <ProjectExplorer projects={projects} />
      )}
    </div>
  );
}
