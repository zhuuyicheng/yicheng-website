import type { Profile } from '@portfolio/shared';
import { MapPin } from 'lucide-react';
import Image from 'next/image';
import portrait from '@/content/photos/portrait.jpg';
import { trackName } from '@/lib/telemetry';
import { ProfileLinkIcon } from './profile-link-icon';
import { ScrollFade } from './scroll-fade';
import { SectionLink } from './section-link';
import { TrackedLink } from './tracked-link';

/**
 * First screen: name, headline and the ways in (projects, contact, profile links), beside a
 * photo. The content fades as you scroll on.
 */
export function Hero({ profile }: { profile: Profile }) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* A warm wash behind the top of the page. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[36rem] bg-gradient-to-b from-brand-soft/70 to-transparent"
      />

      <ScrollFade className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-20 sm:px-6 sm:pt-16 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:py-16">
        <div>
          <p className="text-sm font-medium tracking-wide text-brand">Hi, I&apos;m</p>
          <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight text-ink sm:text-6xl lg:text-7xl">
            {profile.fullName}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
            {profile.headline}
          </p>
          {profile.location !== null && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted">
              <MapPin aria-hidden className="size-4 text-brand" />
              {profile.location}
            </p>
          )}

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <SectionLink
              id="projects"
              className="rounded-full bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-brand-strong"
            >
              View projects
            </SectionLink>
            <SectionLink
              id="contact"
              className="rounded-full border border-line-strong bg-surface px-6 py-3 text-sm font-medium text-ink transition hover:border-brand/60 hover:text-brand"
            >
              Get in touch
            </SectionLink>
            {profile.links.map((link) => (
              <TrackedLink
                key={link.url}
                href={link.url}
                track={trackName(link.label)}
                className="inline-flex items-center gap-2 px-3 py-3 text-sm text-muted transition hover:text-brand"
              >
                <ProfileLinkIcon url={link.url} className="size-4" />
                {link.label}
              </TrackedLink>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-sm sm:max-w-md lg:max-w-none">
          <div
            aria-hidden
            className="absolute -inset-3 -z-10 rotate-3 rounded-[2.25rem] bg-brand-soft sm:-inset-4"
          />
          <Image
            src={portrait}
            alt={`${profile.fullName} smiling in a field of pink flowers, a mountain behind him`}
            priority
            placeholder="blur"
            sizes="(min-width: 1024px) 28rem, (min-width: 640px) 28rem, 90vw"
            className="h-auto w-full rounded-[2rem] shadow-xl"
          />
        </div>
      </ScrollFade>
    </section>
  );
}
