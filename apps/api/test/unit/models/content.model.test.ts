import { describe, expect, it } from 'vitest';
import { portfolioContentSchema } from '../../../src/models/content.model.js';

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
    expect(content.experiences[0]).toMatchObject({ endDate: null, highlights: [] });
    expect(content.projects[0]).toMatchObject({
      techStack: [],
      repoUrl: null,
      liveUrl: null,
      featured: false,
    });
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
