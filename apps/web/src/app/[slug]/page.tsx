import { projectSlugSchema, type ProjectSection } from '@portfolio/shared';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LastUpdated } from '@/components/last-updated';
import { ProjectContents } from '@/components/project-contents';
import { Reveal } from '@/components/reveal';
import { TrackedLink } from '@/components/tracked-link';
import { getProject, getProjects } from '@/lib/api';
import { paragraphs } from '@/lib/format';
import { nextProject, sectionAnchors } from '@/lib/project-page';
import { trackName } from '@/lib/telemetry';

/**
 * Written out instead of Next's generated `PageProps<'/[slug]'>`: that global type
 * only exists after `next typegen` has run, and a fresh checkout (CI) lints before that.
 * In Next.js 16, `params` is a Promise.
 */
interface ProjectPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * A project lives at `/<slug>` (e.g. `/bowling-buddy`). Static routes such as `/admin` win
 * over this one, and the content file refuses slugs that would collide with them. A path that
 * cannot be a slug (`/Foo`, `/a.b`) is a 404 without asking the API.
 */
async function findProject(props: ProjectPageProps) {
  const { slug } = await props.params;
  return projectSlugSchema.safeParse(slug).success ? getProject(slug) : null;
}

export async function generateMetadata(props: ProjectPageProps): Promise<Metadata> {
  const project = await findProject(props);
  return project ? { title: project.title, description: project.summary } : {};
}

/**
 * One project: overview, then its sections (heading, explanation, points) with an "On this
 * page" list beside them on wide screens, when the project last changed, and a way back or on
 * at the end. Unknown slugs (the API answers 404) show the not-found page.
 */
export default async function ProjectPage(props: ProjectPageProps) {
  const [project, projects] = await Promise.all([findProject(props), getProjects()]);
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
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          {project.title}
        </h1>
        <p className="mt-5 text-lg text-muted">{project.summary}</p>
        <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="Technologies">
          {project.techStack.map((tech) => (
            <li key={tech} className="rounded bg-sunken px-2 py-0.5 text-xs text-body">
              {tech}
            </li>
          ))}
        </ul>
        <ProjectLinks slug={project.slug} repoUrl={project.repoUrl} liveUrl={project.liveUrl} />
      </header>

      <div className="mt-12 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-16">
        <div className="max-w-3xl">
          <Reveal className="space-y-5 text-base leading-relaxed text-body sm:text-lg">
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

          <LastUpdated at={project.updatedAt} className="mt-16" />
        </div>

        {contents.length > 1 && (
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <ProjectContents items={contents} />
            </div>
          </aside>
        )}
      </div>

      <footer className="mt-20 flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
        <BackToProjects />
        {next && (
          <Link
            href={`/${next.slug}`}
            className="group rounded-xl border border-line px-5 py-4 transition hover:border-brand/50 hover:bg-surface sm:text-right"
          >
            <span className="block text-xs text-muted">Next project</span>
            <span className="mt-1 block font-medium text-ink">
              {next.title}{' '}
              <ArrowRight
                aria-hidden
                className="inline-block size-4 align-[-2px] transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
              />
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
      prefetch={false} // why: components/section-link.tsx
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-5 py-2.5 text-sm font-medium text-ink transition hover:border-brand/60 hover:text-ink"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Back to projects
    </Link>
  );
}

function Section({ id, section }: { id: string; section: ProjectSection }) {
  return (
    <section id={id} className="mt-14">
      <Reveal>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
          {section.heading}
        </h2>
        {section.body !== null &&
          paragraphs(section.body).map((paragraph) => (
            <p key={paragraph} className="mt-4 leading-relaxed text-body sm:text-lg">
              {paragraph}
            </p>
          ))}
        {section.points.length > 0 && (
          <ul className="mt-5 space-y-3 leading-relaxed text-muted">
            {section.points.map((point) => (
              <li key={point} className="flex gap-3">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" />
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
          className="rounded-md bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-strong"
        >
          Live site ↗
        </TrackedLink>
      )}
      {props.repoUrl !== null && (
        <TrackedLink
          href={props.repoUrl}
          track={trackName(props.slug, 'repo')}
          className="rounded-md border border-line-strong px-4 py-2.5 text-ink hover:border-brand/60 hover:text-brand"
        >
          Source code ↗
        </TrackedLink>
      )}
    </div>
  );
}
