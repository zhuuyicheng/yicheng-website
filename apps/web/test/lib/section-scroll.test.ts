import { describe, expect, it, vi } from 'vitest';
import { scrollToPageTop, scrollToSection } from '@/lib/section-scroll';

function environment(options: { hasSection: boolean; reducedMotion?: boolean }) {
  const scrollIntoView = vi.fn();
  const setHash = vi.fn();
  return {
    scrollIntoView,
    setHash,
    env: {
      findSection: () => (options.hasSection ? { scrollIntoView } : null),
      prefersReducedMotion: () => options.reducedMotion ?? false,
      setHash,
    },
  };
}

describe('scrollToSection (regression: a second click on a header link did nothing)', () => {
  it('scrolls on every click, also when the address already ends in the same #hash', () => {
    const { env, scrollIntoView, setHash } = environment({ hasSection: true });

    expect(scrollToSection('projects', env)).toBe(true);
    expect(scrollToSection('projects', env)).toBe(true);

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(setHash).toHaveBeenCalledWith('#projects');
  });

  it('jumps without animation when the visitor asked for less motion', () => {
    const { env, scrollIntoView } = environment({ hasSection: true, reducedMotion: true });

    scrollToSection('contact', env);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('leaves navigation to the link when the section is not on this page', () => {
    const { env, setHash } = environment({ hasSection: false });

    expect(scrollToSection('projects', env)).toBe(false);
    expect(setHash).not.toHaveBeenCalled();
  });
});

describe('scrollToPageTop (regression: clicking the name on the home page did nothing)', () => {
  it('scrolls to the top and drops the #hash from the address', () => {
    const scrollTo = vi.fn();
    const clearHash = vi.fn();

    scrollToPageTop({ scrollTo, prefersReducedMotion: () => false, clearHash });

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(clearHash).toHaveBeenCalledOnce();
  });

  it('jumps without animation when the visitor asked for less motion', () => {
    const scrollTo = vi.fn();

    scrollToPageTop({ scrollTo, prefersReducedMotion: () => true, clearHash: vi.fn() });

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });
});
