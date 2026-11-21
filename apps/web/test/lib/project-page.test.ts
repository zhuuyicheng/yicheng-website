import type { ProjectSummary } from '@portfolio/shared';
import { describe, expect, it } from 'vitest';
import { nextProject, sectionAnchors } from '@/lib/project-page';

function project(slug: string): ProjectSummary {
  return {
    slug,
    title: slug,
    summary: '',
    techStack: [],
    repoUrl: null,
    liveUrl: null,
    featured: false,
  };
}

describe('sectionAnchors', () => {
  it('turns headings into lowercase, hyphenated ids', () => {
    expect(sectionAnchors(['How a page is served', 'Contact form & rate limiting'])).toEqual([
      'how-a-page-is-served',
      'contact-form-rate-limiting',
    ]);
  });

  it('numbers repeated headings so every id is unique', () => {
    expect(sectionAnchors(['Tools', 'tools', 'Tools!'])).toEqual(['tools', 'tools-2', 'tools-3']);
  });

  it('falls back to "section" for a heading with no letters or digits', () => {
    expect(sectionAnchors(['★★', '—'])).toEqual(['section', 'section-2']);
  });
});

describe('nextProject', () => {
  const projects = [project('a'), project('b'), project('c')];

  it('returns the following project in display order', () => {
    expect(nextProject(projects, 'a')?.slug).toBe('b');
  });

  // Regression: the last project used to lead back to the first.
  it('offers no next project after the last one', () => {
    expect(nextProject(projects, 'c')).toBeNull();
  });

  it('returns null for an unknown slug or a single project', () => {
    expect(nextProject(projects, 'missing')).toBeNull();
    expect(nextProject([project('a')], 'a')).toBeNull();
  });
});
