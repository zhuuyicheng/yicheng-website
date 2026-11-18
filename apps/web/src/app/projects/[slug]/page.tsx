import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Reveal } from '@/components/reveal';
import { TrackedLink } from '@/components/tracked-link';
import { getProject } from '@/lib/api';
import { trackName } from '@/lib/telemetry';

export async function generateMetadata(props: PageProps<'/projects/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const project = await getProject(slug);
  return project ? { title: project.title, description: project.summary } : {};
}

/** One project. Unknown slugs (the API answers 404) show the not-found page. */
export default async function ProjectPage(props: PageProps<'/projects/[slug]'>) {
  const { slug } = await props.params;
  const project = await getProject(slug);
  if (!project) {
    notFound();
  }

  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <Link href="/#projects" className="font-mono text-xs text-zinc-500 hover:text-emerald-300">
        ← cd ..
      </Link>

      <p className="mt-10 font-mono text-xs text-zinc-500 sm:text-sm">
        <span className="text-zinc-600">$</span> cat projects/{project.slug}.md
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
        {project.title}
      </h1>
      <p className="mt-5 text-lg text-zinc-400">{project.summary}</p>

      <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="Technologies">
        {project.techStack.map((tech) => (
          <li key={tech} className="rounded bg-white/5 px-2 py-0.5 font-mono text-xs text-zinc-300">
            {tech}
          </li>
        ))}
      </ul>

      <Reveal className="mt-12 space-y-5 text-base leading-relaxed text-zinc-300 sm:text-lg">
        {project.description.split(/\n{2,}/).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </Reveal>

      {(project.repoUrl !== null || project.liveUrl !== null) && (
        <div className="mt-12 flex flex-wrap gap-3 font-mono text-sm">
          {project.repoUrl !== null && (
            <TrackedLink
              href={project.repoUrl}
              track={trackName(project.slug, 'repo')}
              className="rounded-md border border-white/15 px-4 py-2 text-zinc-200 hover:border-emerald-400/60 hover:text-emerald-300"
            >
              source ↗
            </TrackedLink>
          )}
          {project.liveUrl !== null && (
            <TrackedLink
              href={project.liveUrl}
              track={trackName(project.slug, 'live')}
              className="rounded-md bg-emerald-400 px-4 py-2 text-zinc-950 hover:bg-emerald-300"
            >
              live ↗
            </TrackedLink>
          )}
        </div>
      )}
    </article>
  );
}
