import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PortfolioContent } from '../../src/schema/content.schema.js';
import { createContentDal, type ContentDal } from '../../src/dal/content.dal.js';
import { SAMPLE_CONTENT } from '../helpers/sample-content.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';

/** A date still equal to this wasn't touched by the seed. */
const LONG_AGO = '2020-01-01T00:00:00.000Z';

type ContentProject = PortfolioContent['projects'][number];

function withProject(slug: string, changes: Partial<ContentProject>): PortfolioContent {
  return {
    ...SAMPLE_CONTENT,
    projects: SAMPLE_CONTENT.projects.map((project) =>
      project.slug === slug ? { ...project, ...changes } : project,
    ),
  };
}

describe('content:seed moves the "Last updated" dates only for real changes', () => {
  let deps: TestDependencies;
  let dal: ContentDal;

  beforeAll(async () => {
    deps = await createTestDependencies();
    dal = createContentDal(deps.postgres);
  });

  afterAll(async () => {
    await deps.close();
  });

  beforeEach(async () => {
    // Publish the sample, then pretend it was long ago.
    await deps.postgres.query('TRUNCATE profile, experiences, education, projects');
    await dal.replaceAll(SAMPLE_CONTENT);
    await deps.postgres.query('UPDATE profile SET content_updated_at = $1', [LONG_AGO]);
    await deps.postgres.query('UPDATE projects SET updated_at = $1', [LONG_AGO]);
  });

  /** The home page's date and each project page's. */
  async function pageDates() {
    const [profile, noteG, bernoulli] = await Promise.all([
      dal.findProfile(),
      dal.findProjectBySlug('note-g'),
      dal.findProjectBySlug('bernoulli-numbers'),
    ]);
    return {
      home: profile?.contentUpdatedAt,
      noteG: noteG?.updatedAt,
      bernoulli: bernoulli?.updatedAt,
    };
  }

  async function experienceIds() {
    const result = await deps.postgres.query<{ id: string }>(
      'SELECT id FROM experiences ORDER BY sort_order',
    );
    return result.rows.map((row) => row.id);
  }

  it('publishing the same content again changes nothing, not even experience ids', async () => {
    const idsBefore = await experienceIds();

    expect(await dal.replaceAll(SAMPLE_CONTENT)).toBe(false);

    expect(await pageDates()).toEqual({ home: LONG_AGO, noteG: LONG_AGO, bernoulli: LONG_AGO });
    expect(await experienceIds()).toEqual(idsBefore);
  });

  it('editing one project moves its date and the home page date, not the others', async () => {
    expect(await dal.replaceAll(withProject('note-g', { title: 'Note G, revised' }))).toBe(true);

    const dates = await pageDates();
    expect(dates.noteG).not.toBe(LONG_AGO);
    expect(dates.bernoulli).toBe(LONG_AGO);
    expect(dates.home).toBe(dates.noteG); // one transaction, one now()
  });

  it('moving a project in the list counts as a change (its sort_order differs)', async () => {
    const reordered = { ...SAMPLE_CONTENT, projects: [...SAMPLE_CONTENT.projects].reverse() };

    expect(await dal.replaceAll(reordered)).toBe(true);

    const dates = await pageDates();
    expect(dates.noteG).not.toBe(LONG_AGO);
    expect(dates.bernoulli).not.toBe(LONG_AGO);
    expect(dates.home).not.toBe(LONG_AGO);
  });

  it('removing a project moves the home page date', async () => {
    // note-g is last, so bernoulli-numbers keeps its place and date.
    const withoutNoteG = { ...SAMPLE_CONTENT, projects: SAMPLE_CONTENT.projects.slice(0, 1) };

    expect(await dal.replaceAll(withoutNoteG)).toBe(true);

    const dates = await pageDates();
    expect(dates.noteG).toBeUndefined();
    expect(dates.bernoulli).toBe(LONG_AGO);
    expect(dates.home).not.toBe(LONG_AGO);
  });

  it.each<[string, PortfolioContent]>([
    [
      'the profile',
      { ...SAMPLE_CONTENT, profile: { ...SAMPLE_CONTENT.profile, headline: 'Poet' } },
    ],
    ['the experiences', { ...SAMPLE_CONTENT, experiences: SAMPLE_CONTENT.experiences.slice(1) }],
    [
      'the order of education',
      { ...SAMPLE_CONTENT, education: [...SAMPLE_CONTENT.education].reverse() },
    ],
  ])('a change to %s moves only the home page date', async (_change, content) => {
    expect(await dal.replaceAll(content)).toBe(true);

    const dates = await pageDates();
    expect(dates.home).not.toBe(LONG_AGO);
    expect(dates.noteG).toBe(LONG_AGO);
    expect(dates.bernoulli).toBe(LONG_AGO);
  });
});
