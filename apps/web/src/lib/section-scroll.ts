/**
 * Scrolling to a home-page section (`/#projects`) from the header or the hero.
 *
 * Next.js's <Link> treats a click on `/#projects` as "already there" once the address ends
 * in `#projects`, so after scrolling back up, a second click on "Projects" did nothing.
 * Scrolling explicitly works on every click; the address still gets the `#hash`, so the link
 * can be shared and the back button behaves.
 */
export interface ScrollEnvironment {
  findSection: (id: string) => { scrollIntoView: (options: ScrollIntoViewOptions) => void } | null;
  prefersReducedMotion: () => boolean;
  setHash: (hash: string) => void;
}

/** Scrolls to `id` and returns true; false if this page has no such section (navigate instead). */
export function scrollToSection(id: string, environment: ScrollEnvironment): boolean {
  const section = environment.findSection(id);
  if (section === null) {
    return false;
  }
  section.scrollIntoView({
    behavior: environment.prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });
  environment.setHash(`#${id}`);
  return true;
}

/** The real browser, for components. */
export function browserScrollEnvironment(): ScrollEnvironment {
  return {
    findSection: (id) => document.getElementById(id),
    prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    setHash: (hash) => {
      window.history.replaceState(window.history.state, '', hash);
    },
  };
}
