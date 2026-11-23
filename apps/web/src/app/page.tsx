import { BriefcaseBusiness, Camera, FolderOpen, Mail, MapPin, Smile } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ContactForm } from '@/components/contact-form';
import { ExperienceTimeline, type TimelineEntryData } from '@/components/experience-timeline';
import { Hero } from '@/components/hero';
import { LastUpdated } from '@/components/last-updated';
import { PhotoCarousel } from '@/components/photo-carousel';
import { ProfileLinkIcon } from '@/components/profile-link-icon';
import { ProjectExplorer } from '@/components/project-explorer';
import { Reveal } from '@/components/reveal';
import { SectionHeading } from '@/components/section-heading';
import { TrackedLink } from '@/components/tracked-link';
import { PHOTOS } from '@/content/photos';
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
 * The home page, rendered per request from the API: hero, about, experience, projects, photos,
 * contact. Alternate sections sit on a white band.
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
        <SectionHeading title="About Me" icon={Smile} />
        <Reveal className="grid gap-10 md:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4 text-base leading-relaxed text-body sm:text-lg">
            {paragraphs(profile.summary).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <dl className="h-fit space-y-5 rounded-2xl border border-line bg-surface p-6 text-sm shadow-sm">
            {profile.location !== null && (
              <div className="flex gap-3">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                <div>
                  <dt className="text-muted">Location</dt>
                  <dd className="text-ink">{profile.location}</dd>
                </div>
              </div>
            )}
            {profile.links.map((link) => (
              <div key={link.url} className="flex gap-3">
                <ProfileLinkIcon url={link.url} className="mt-0.5 size-4 shrink-0 text-brand" />
                <div className="min-w-0">
                  <dt className="text-muted">{link.label}</dt>
                  <dd>
                    <TrackedLink
                      href={link.url}
                      track={trackName(link.label)}
                      className="break-all text-ink underline-offset-4 hover:text-brand hover:underline"
                    >
                      {link.url.replace(/^https?:\/\/(www\.)?/, '')}
                    </TrackedLink>
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </Reveal>
      </Section>

      <Section id="experience" raised>
        <SectionHeading title="Experience & education" icon={BriefcaseBusiness} />
        <ExperienceTimeline entries={timeline} />
      </Section>

      <Section id="projects">
        <SectionHeading title="Projects" icon={FolderOpen} />
        <ProjectExplorer projects={projects} />
      </Section>

      <Section id="life" raised>
        <SectionHeading title="Outside work" icon={Camera} />
        <Reveal>
          <PhotoCarousel photos={PHOTOS} />
        </Reveal>
      </Section>

      <Section id="contact">
        <SectionHeading title="Get in touch" icon={Mail} />
        <Reveal className="max-w-3xl">
          <ContactForm />
        </Reveal>
        <LastUpdated at={profile.contentUpdatedAt} className="mt-16" />
      </Section>
    </>
  );
}

function Section({
  id,
  raised = false,
  children,
}: {
  id: string;
  raised?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`border-t border-line ${raised ? 'bg-surface' : ''}`}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">{children}</div>
    </section>
  );
}

/** Before `npm run content:seed` (the API answers 404 for the profile). */
function NotSeeded() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-32 text-sm sm:px-6">
      <p className="text-amber-700">No profile yet.</p>
      <p className="mt-3 text-muted">
        The API has no content yet. Run <code className="text-ink">npm run content:seed</code> and
        reload.
      </p>
    </div>
  );
}
