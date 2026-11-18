import type { Profile, ProjectSummary } from '@portfolio/shared';
import { trackName } from '@/lib/telemetry';
import { LiveStatusPill } from './live-status-pill';
import { ScrollFade } from './scroll-fade';
import { Spotlight } from './spotlight';
import { TrackedLink } from './tracked-link';
import { TypedText } from './typed-text';

/** The most used technologies across all projects, most frequent first. */
function topTechnologies(projects: readonly ProjectSummary[], count: number): string[] {
  const uses = new Map<string, number>();
  for (const tech of projects.flatMap((project) => project.techStack)) {
    uses.set(tech, (uses.get(tech) ?? 0) + 1);
  }
  return [...uses.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([tech]) => tech);
}

/**
 * First screen: a terminal prompt typing `whoami`, the name and headline, and a "response"
 * card built from the real profile data. The grid and glow sit behind it; the content fades
 * as you scroll on.
 */
export function Hero({ profile, projects }: { profile: Profile; projects: ProjectSummary[] }) {
  const stack = topTechnologies(projects, 5);

  return (
    <section className="relative isolate flex min-h-[calc(100svh-3.5rem)] items-center overflow-hidden">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10" />
      <Spotlight className="absolute inset-0 -z-10" />

      <ScrollFade className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="mb-6">
            <LiveStatusPill />
          </div>
          <p className="font-mono text-sm text-zinc-500">
            <span className="text-emerald-400">~/yicheng</span>{' '}
            <span className="text-zinc-600">$</span>{' '}
            <TypedText text="whoami" className="text-zinc-300" />
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl lg:text-7xl">
            {profile.fullName}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-zinc-400 sm:text-xl">{profile.headline}</p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#projects"
              className="rounded-md bg-emerald-400 px-4 py-2.5 font-mono text-sm font-medium text-zinc-950 transition hover:bg-emerald-300"
            >
              ./projects
            </a>
            <a
              href="#contact"
              className="rounded-md border border-white/15 px-4 py-2.5 font-mono text-sm text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-300"
            >
              ./contact
            </a>
            {profile.links.map((link) => (
              <TrackedLink
                key={link.url}
                href={link.url}
                track={trackName(link.label)}
                className="px-2 py-2.5 font-mono text-sm text-zinc-400 underline-offset-4 transition hover:text-emerald-300 hover:underline"
              >
                {link.label} ↗
              </TrackedLink>
            ))}
          </div>
        </div>

        {/* Looks like an API response, because it is one: the real profile, reshaped. */}
        <pre
          aria-label="Profile summary"
          className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-900/60 p-5 font-mono text-xs leading-relaxed text-zinc-400 shadow-2xl shadow-emerald-950/30 backdrop-blur sm:text-sm"
        >
          <span className="text-zinc-600">{'// GET /api/v1/profile → 200'}</span>
          {'\n{\n'}
          <Field name="name" value={profile.fullName} />
          {profile.location !== null && <Field name="location" value={profile.location} />}
          <Field name="roles" value={profile.experiences.length} />
          <Field name="projects" value={projects.length} />
          {'  '}
          <span className="text-cyan-300">&quot;stack&quot;</span>: [
          {stack.map((tech, index) => (
            <span key={tech}>
              <span className="text-emerald-300">&quot;{tech}&quot;</span>
              {index < stack.length - 1 ? ', ' : ''}
            </span>
          ))}
          ]{'\n}'}
        </pre>
      </ScrollFade>

      <a
        href="#about"
        aria-label="Scroll to about"
        className="animate-scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-xs text-zinc-500"
      >
        scroll ↓
      </a>
    </section>
  );
}

function Field({ name, value }: { name: string; value: string | number }) {
  return (
    <>
      {'  '}
      <span className="text-cyan-300">&quot;{name}&quot;</span>:{' '}
      {typeof value === 'number' ? (
        <span className="text-amber-300">{value}</span>
      ) : (
        <span className="text-emerald-300">&quot;{value}&quot;</span>
      )}
      {',\n'}
    </>
  );
}
