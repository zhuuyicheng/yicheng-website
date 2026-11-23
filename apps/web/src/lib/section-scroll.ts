/**
 * Scrolls to a home-page section (`/#projects`). Next's <Link> ignores a second click once the
 * address ends in `#projects`; scrolling ourselves works every time and still sets the hash.
 */
export interface ScrollEnvironment {
  findSection: (id: string) => { scrollIntoView: (options: ScrollIntoViewOptions) => void } | null;
  prefersReducedMotion: () => boolean;
  setHash: (hash: string) => void;
}

/** Scrolls to `id` and returns true; false if there's no such section here (navigate instead). */
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

/**
 * Back to the top of the home page (the header's name): <Link href="/"> does nothing when
 * already on `/`. Also clears the `#hash`.
 */
export interface TopEnvironment {
  scrollTo: (options: ScrollToOptions) => void;
  prefersReducedMotion: () => boolean;
  clearHash: () => void;
}

export function scrollToPageTop(environment: TopEnvironment): void {
  environment.scrollTo({
    top: 0,
    behavior: environment.prefersReducedMotion() ? 'auto' : 'smooth',
  });
  environment.clearHash();
}

/** The real browser, for components. */
export function browserTopEnvironment(): TopEnvironment {
  return {
    scrollTo: (options) => {
      window.scrollTo(options);
    },
    prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    clearHash: () => {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    },
  };
}
