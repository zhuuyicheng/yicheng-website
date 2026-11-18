import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ContactForm } from '@/components/contact-form';
import { ExperienceTimeline, type TimelineEntryData } from '@/components/experience-timeline';
import { Hero } from '@/components/hero';
import { ProjectExplorer } from '@/components/project-explorer';
import { Reveal } from '@/components/reveal';
import { SectionHeading } from '@/components/section-heading';
import { TrackedLink } from '@/components/tracked-link';
import { getProfile, getProjects } from '@/lib/api';
import { paragraphs } from '@/lib/format';
import { trackName } from '@/lib/telemetry';

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getProfile();
  if (!profile) return {};
  return {
    title: { absolute: `${profile.fullName} · ${profile.headline}` },
    description: profile.summary.slice(0, 160),
  };
}

/**
 * The home page, rendered on the server for each request from the API's data (which the API
 * serves from its Redis cache). Sections in scroll order: hero, about, experience, projects,
 * contact.
 */
export default async function HomePage() {
  const [profile, projects] = await Promise.all([getProfile(), getProjects()]);
  if (!profile) {
    return <NotSeeded />;
  }

  const timeline: TimelineEntryData[] = [
    ...profile.experiences.map((item) => ({ kind: 'work' as const, item })),
    ...profile.education.map((item) => ({ kind: 'study' as const, item })),
  ];

  return (
    <>
      <Hero profile={profile} />

      <Section id="about">
        <SectionHeading title="About" />
        <Reveal className="grid gap-10 md:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4 text-base leading-relaxed text-zinc-300 sm:text-lg">
            {paragraphs(profile.summary).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <dl className="space-y-4 text-sm">
            {profile.location !== null && (
              <div>
                <dt className="text-zinc-500">Location</dt>
                <dd className="text-zinc-300">{profile.location}</dd>
              </div>
            )}
            {profile.links.map((link) => (
              <div key={link.url}>
                <dt className="text-zinc-500">{link.label}</dt>
                <dd>
                  <TrackedLink
                    href={link.url}
                    track={trackName(link.label)}
                    className="break-all text-emerald-300 hover:underline"
                  >
                    {link.url.replace(/^https?:\/\//, '')}
                  </TrackedLink>
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Section>

      <Section id="experience">
        <SectionHeading title="Experience & education" />
        <ExperienceTimeline entries={timeline} />
      </Section>

      <Section id="projects">
        <SectionHeading title="Projects" />
        <ProjectExplorer projects={projects} />
      </Section>

      <Section id="contact">
        <SectionHeading title="Get in touch" />
        <Reveal className="max-w-3xl">
          <ContactForm />
        </Reveal>
      </Section>
    </>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-white/5">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">{children}</div>
    </section>
  );
}

/** Shown before `npm run content:seed` has been run (the API answers 404 for the profile). */
function NotSeeded() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-32 text-sm sm:px-6">
      <p className="text-amber-300">No profile yet.</p>
      <p className="mt-3 text-zinc-400">
        The API has no content yet. Run <code className="text-zinc-200">npm run content:seed</code>{' '}
        and reload.
      </p>
    </div>
  );
}
