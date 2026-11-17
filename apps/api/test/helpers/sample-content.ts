import type { PortfolioContent } from '../../src/models/content.model.js';

/** Small, fixed portfolio used by unit and integration tests (independent of portfolio.json). */
export const SAMPLE_CONTENT: PortfolioContent = {
  profile: {
    fullName: 'Ada Lovelace',
    headline: 'Analytical Engine Programmer',
    summary: 'Writes the first algorithms.',
    location: 'London',
    links: [{ label: 'GitHub', url: 'https://github.com/example' }],
  },
  experiences: [
    {
      company: 'Analytical Engine Ltd',
      role: 'Programmer',
      startDate: '1842-01-01',
      endDate: null,
      highlights: ['Published Note G'],
    },
    {
      company: 'Difference Engine Co',
      role: 'Translator',
      startDate: '1840-03-01',
      endDate: '1841-12-31',
      highlights: [],
    },
  ],
  projects: [
    {
      slug: 'bernoulli-numbers',
      title: 'Bernoulli Numbers',
      summary: 'Computes Bernoulli numbers.',
      description: 'The first published computer program.',
      techStack: ['Analytical Engine'],
      repoUrl: null,
      liveUrl: null,
      featured: false,
    },
    {
      slug: 'note-g',
      title: 'Note G',
      summary: 'Annotated translation.',
      description: 'Notes on the Analytical Engine.',
      techStack: [],
      repoUrl: 'https://github.com/example/note-g',
      liveUrl: null,
      featured: true,
    },
  ],
};
