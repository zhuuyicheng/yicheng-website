import type { PortfolioContent } from '../../src/schema/content.schema.js';

/** A small fixed portfolio for tests (independent of portfolio.json). */
export const SAMPLE_CONTENT: PortfolioContent = {
  profile: {
    fullName: 'Ada Lovelace',
    headline: 'Analytical Engine Programmer',
    summary: 'Writes the first algorithms.',
    location: 'London',
    links: [
      { label: 'GitHub', url: 'https://github.com/example', text: 'See my code' },
      { label: 'Website', url: 'https://example.com' },
    ],
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
  education: [
    {
      institution: 'University of London',
      qualification: 'Mathematics (private tuition)',
      startDate: '1840-01-01',
      endDate: '1841-12-31',
      highlights: ['Studied under Augustus De Morgan'],
    },
    {
      institution: 'Home schooling',
      qualification: 'Mathematics and Science',
      startDate: '1825-01-01',
      endDate: null,
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
      sections: [],
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
      sections: [
        {
          heading: 'How it works',
          body: 'A table of operations.\n\nOne row per step.',
          points: ['Loops over the variables', 'Stores results on the Store'],
        },
        { heading: 'Legacy', body: null, points: ['Called the first program'] },
      ],
    },
  ],
};
