import type { Profile } from '@portfolio/shared';
import { trackName } from '@/lib/telemetry';
import { ScrollFade } from './scroll-fade';
import { Spotlight } from './spotlight';
import { TrackedLink } from './tracked-link';

/**
 * First screen: name, headline and the ways in (projects, contact, profile links). The grid
 * and glow sit behind it; the content fades as you scroll on.
 */
export function Hero({ profile }: { profile: Profile }) {
  return (
    <section className="relative isolate flex min-h-[calc(100svh-3.5rem)] items-center overflow-hidden">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10" />
      <Spotlight className="absolute inset-0 -z-10" />

      <ScrollFade className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl lg:text-7xl">
            {profile.fullName}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-zinc-400 sm:text-xl">{profile.headline}</p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a
              href="#projects"
              className="rounded-md bg-emerald-400 px-5 py-3 text-sm font-medium text-zinc-950 transition hover:bg-emerald-300"
            >
              View projects
            </a>
            <a
              href="#contact"
              className="rounded-md border border-white/15 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-300"
            >
              Get in touch
            </a>
            {profile.links.map((link) => (
              <TrackedLink
                key={link.url}
                href={link.url}
                track={trackName(link.label)}
                className="px-2 py-3 text-sm text-zinc-400 underline-offset-4 transition hover:text-emerald-300 hover:underline"
              >
                {link.label} ↗
              </TrackedLink>
            ))}
          </div>
        </div>
      </ScrollFade>

      <a
        href="#about"
        aria-label="Scroll to about"
        className="animate-scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-zinc-500"
      >
        scroll ↓
      </a>
    </section>
  );
}
