import { describe, expect, it } from 'vitest';
import { portfolioContentSchema } from '../../../src/schema/content.schema.js';

const MINIMAL_CONTENT = {
  profile: { fullName: 'Ada', headline: 'Programmer', summary: 'Hi.' },
  experiences: [{ company: 'Engine Co', role: 'Programmer', startDate: '1842-01-01' }],
  projects: [{ slug: 'note-g', title: 'Note G', summary: 'S', description: 'D' }],
};

function problems(input: unknown): string[] {
  const result = portfolioContentSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('portfolioContentSchema (content/portfolio.json)', () => {
  it('fills in defaults for optional fields', () => {
    const content = portfolioContentSchema.parse(MINIMAL_CONTENT);

    expect(content.profile).toMatchObject({ location: null, links: [] });
    expect(content.education).toEqual([]);
    expect(content.experiences[0]).toMatchObject({ endDate: null, highlights: [] });
    expect(content.projects[0]).toMatchObject({
      techStack: [],
      repoUrl: null,
      liveUrl: null,
      featured: false,
      sections: [],
    });
  });

  it('fills in a section without a body or points, and accepts either one alone', () => {
    const project = {
      ...MINIMAL_CONTENT.projects[0],
      sections: [
        { heading: 'Overview', body: 'Text.' },
        { heading: 'Features', points: ['One'] },
      ],
    };
    const content = portfolioContentSchema.parse({ ...MINIMAL_CONTENT, projects: [project] });

    expect(content.projects[0]?.sections).toEqual([
      { heading: 'Overview', body: 'Text.', points: [] },
      { heading: 'Features', body: null, points: ['One'] },
    ]);
  });

  it('rejects a section with nothing under its heading', () => {
    const project = { ...MINIMAL_CONTENT.projects[0], sections: [{ heading: 'Empty' }] };
    expect(problems({ ...MINIMAL_CONTENT, projects: [project] })).toEqual([
      'projects.0.sections.0.points: needs a body or at least one point',
    ]);
  });

  it('rejects more than 20 sections on one project', () => {
    const sections = Array.from({ length: 21 }, (_, index) => ({
      heading: `Part ${String(index)}`,
      points: ['x'],
    }));
    const project = { ...MINIMAL_CONTENT.projects[0], sections };
    expect(problems({ ...MINIMAL_CONTENT, projects: [project] })).toHaveLength(1);
  });

  it('rejects a slug that is already a page of the site', () => {
    const project = { ...MINIMAL_CONTENT.projects[0], slug: 'admin' };
    expect(problems({ ...MINIMAL_CONTENT, projects: [project] })).toEqual([
      'projects.0.slug: is already a page of the site; choose another slug',
    ]);
  });

  it('rejects duplicate project slugs', () => {
    const project = MINIMAL_CONTENT.projects[0];
    expect(problems({ ...MINIMAL_CONTENT, projects: [project, project] })).toEqual([
      'projects.1.slug: duplicate slug "note-g"',
    ]);
  });

  it('rejects an experience that ends before it starts', () => {
    const experience = { company: 'C', role: 'R', startDate: '2024-05-01', endDate: '2024-01-01' };
    expect(problems({ ...MINIMAL_CONTENT, experiences: [experience] })).toEqual([
      'experiences.0.endDate: must not be before startDate',
    ]);
  });

  it('rejects an education entry that ends before it starts', () => {
    const entry = {
      institution: 'NUS',
      qualification: 'BComp',
      startDate: '2026-05-01',
      endDate: '2022-01-01',
    };
    expect(problems({ ...MINIMAL_CONTENT, education: [entry] })).toEqual([
      'education.0.endDate: must not be before startDate',
    ]);
  });

  it('fills in defaults for education entries', () => {
    const content = portfolioContentSchema.parse({
      ...MINIMAL_CONTENT,
      education: [{ institution: 'NUS', qualification: 'BComp', startDate: '2022-01-01' }],
    });

    expect(content.education[0]).toMatchObject({ endDate: null, highlights: [] });
  });

  it('takes an optional text for a link, never an empty one', () => {
    const withText = (text: string) =>
      portfolioContentSchema.parse({
        ...MINIMAL_CONTENT,
        profile: {
          ...MINIMAL_CONTENT.profile,
          links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/x', text }],
        },
      });

    expect(withText(' View my LinkedIn profile ')).toMatchObject({
      profile: { links: [{ text: 'View my LinkedIn profile' }] },
    });
    expect(() => withText('  ')).toThrow();
  });

  it('rejects non-http links and malformed slugs', () => {
    const result = problems({
      ...MINIMAL_CONTENT,
      profile: { ...MINIMAL_CONTENT.profile, links: [{ label: 'x', url: 'javascript:alert(1)' }] },
      projects: [{ ...MINIMAL_CONTENT.projects[0], slug: 'Has Spaces' }],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatch(/^profile\.links\.0\.url:/);
    expect(result[1]).toMatch(/^projects\.0\.slug:/);
  });
});
