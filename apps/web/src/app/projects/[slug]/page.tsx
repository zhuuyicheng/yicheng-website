import type { ProjectSection } from '@portfolio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectContents } from '@/components/project-contents';
import { Reveal } from '@/components/reveal';
import { TrackedLink } from '@/components/tracked-link';
import { getProject, getProjects } from '@/lib/api';
import { paragraphs } from '@/lib/format';
import { nextProject, sectionAnchors } from '@/lib/project-page';
import { trackName } from '@/lib/telemetry';

/**
 * Written out instead of Next's generated `PageProps<'/projects/[slug]'>`: that global type
 * only exists after `next typegen` has run, and a fresh checkout (CI) lints before that.
 * In Next.js 16, `params` is a Promise.
 */
interface ProjectPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(props: ProjectPageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const project = await getProject(slug);
  return project ? { title: project.title, description: project.summary } : {};
}

/**
 * One project: overview, then its sections (heading, explanation, points) with an "On this
 * page" list beside them on wide screens, and a way back or on at the end. Unknown slugs (the
 * API answers 404) show the not-found page.
 */
export default async function ProjectPage(props: ProjectPageProps) {
  const { slug } = await props.params;
  const [project, projects] = await Promise.all([getProject(slug), getProjects()]);
  if (!project) {
    notFound();
  }

  const anchors = sectionAnchors(project.sections.map((section) => section.heading));
  const contents = project.sections.map((section, index) => ({
    id: anchors[index] ?? `section-${String(index + 1)}`,
    heading: section.heading,
  }));
  const next = nextProject(projects, project.slug);

  return (
    <article className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <BackToProjects />

      <header className="mt-10 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          {project.title}
        </h1>
        <p className="mt-5 text-lg text-zinc-400">{project.summary}</p>
        <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="Technologies">
          {project.techStack.map((tech) => (
            <li key={tech} className="rounded bg-white/5 px-2 py-0.5 text-xs text-zinc-300">
              {tech}
            </li>
          ))}
        </ul>
        <ProjectLinks slug={project.slug} repoUrl={project.repoUrl} liveUrl={project.liveUrl} />
      </header>

      <div className="mt-12 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-16">
        <div className="max-w-3xl">
          <Reveal className="space-y-5 text-base leading-relaxed text-zinc-300 sm:text-lg">
            {paragraphs(project.description).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </Reveal>

          {project.sections.map((section, index) => (
            <Section
              key={contents[index]?.id ?? section.heading}
              id={contents[index]?.id ?? `section-${String(index + 1)}`}
              section={section}
            />
          ))}
        </div>

        {contents.length > 1 && (
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <ProjectContents items={contents} />
            </div>
          </aside>
        )}
      </div>

      <footer className="mt-20 flex flex-col gap-4 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
        <BackToProjects />
        {next && (
          <Link
            href={`/projects/${next.slug}`}
            className="group rounded-xl border border-white/10 px-5 py-4 transition hover:border-emerald-400/50 hover:bg-zinc-900/60 sm:text-right"
          >
            <span className="block text-xs text-zinc-500">Next project</span>
            <span className="mt-1 block font-medium text-zinc-100">
              {next.title}{' '}
              <span
                aria-hidden
                className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
              >
                →
              </span>
            </span>
          </Link>
        )}
      </footer>
    </article>
  );
}

/** A large, clearly labelled way back: easy to hit with a thumb (at least 44 px tall). */
function BackToProjects() {
  return (
    <Link
      href="/#projects"
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-zinc-900/60 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-emerald-400/60 hover:text-white"
    >
      <span aria-hidden>←</span>
      Back to projects
    </Link>
  );
}

function Section({ id, section }: { id: string; section: ProjectSection }) {
  return (
    <section id={id} className="mt-14">
      <Reveal>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{section.heading}</h2>
        {section.body !== null &&
          paragraphs(section.body).map((paragraph) => (
            <p key={paragraph} className="mt-4 leading-relaxed text-zinc-300 sm:text-lg">
              {paragraph}
            </p>
          ))}
        {section.points.length > 0 && (
          <ul className="mt-5 space-y-3 leading-relaxed text-zinc-400">
            {section.points.map((point) => (
              <li key={point} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2.5 size-1.5 shrink-0 rounded-full bg-emerald-400"
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </section>
  );
}

function ProjectLinks(props: { slug: string; repoUrl: string | null; liveUrl: string | null }) {
  if (props.repoUrl === null && props.liveUrl === null) {
    return null;
  }
  return (
    <div className="mt-8 flex flex-wrap gap-3 text-sm">
      {props.liveUrl !== null && (
        <TrackedLink
          href={props.liveUrl}
          track={trackName(props.slug, 'live')}
          className="rounded-md bg-emerald-400 px-4 py-2.5 font-medium text-zinc-950 hover:bg-emerald-300"
        >
          Live site ↗
        </TrackedLink>
      )}
      {props.repoUrl !== null && (
        <TrackedLink
          href={props.repoUrl}
          track={trackName(props.slug, 'repo')}
          className="rounded-md border border-white/15 px-4 py-2.5 text-zinc-200 hover:border-emerald-400/60 hover:text-emerald-300"
        >
          Source code ↗
        </TrackedLink>
      )}
    </div>
  );
}
