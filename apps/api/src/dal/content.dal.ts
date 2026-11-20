import type { PoolClient } from 'pg';
import type { EducationRow, ExperienceRow, ProfileRow, ProjectRow } from '../dao/content.dao.js';
import type { PostgresPool } from '../infra/postgres.js';
import type {
  Education,
  Experience,
  PortfolioContent,
  Profile,
  Project,
  ProjectSummary,
} from '../schema/content.schema.js';

/**
 * All SQL for portfolio content. Reads return rows shaped like `dao/` and map them to the API
 * types in `schema/`; `replaceAll` serves `content:seed`.
 */
export interface ContentDal {
  /** `null` until content has been seeded. */
  findProfile: () => Promise<Profile | null>;
  listProjects: () => Promise<ProjectSummary[]>;
  findProjectBySlug: (slug: string) => Promise<Project | null>;
  /** Makes the database match `content` exactly, in one transaction. */
  replaceAll: (content: PortfolioContent) => Promise<void>;
}

// Column lists match the row types in dao/content.dao.ts. Dates go through to_char (see there).
const PROFILE_COLUMNS = 'id, full_name, headline, summary, location, links, updated_at';

const EXPERIENCE_COLUMNS = `id, company, role,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD')   AS end_date,
  highlights, sort_order, created_at, updated_at`;

const EDUCATION_COLUMNS = `id, institution, qualification,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD')   AS end_date,
  highlights, sort_order, created_at, updated_at`;

const PROJECT_COLUMNS = `id, slug, title, summary, description, tech_stack, repo_url, live_url,
  featured, sections, sort_order, created_at, updated_at`;

const PROJECT_DISPLAY_ORDER = 'ORDER BY featured DESC, sort_order, slug';

export function createContentDal(pool: PostgresPool): ContentDal {
  return {
    async findProfile() {
      const profiles = await pool.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM profile WHERE id = 1`,
      );
      const profile = profiles.rows[0];
      if (!profile) {
        return null;
      }

      // Independent lists, so both queries run at the same time.
      const [experiences, education] = await Promise.all([
        pool.query<ExperienceRow>(
          `SELECT ${EXPERIENCE_COLUMNS} FROM experiences ORDER BY sort_order, start_date DESC`,
        ),
        pool.query<EducationRow>(
          `SELECT ${EDUCATION_COLUMNS} FROM education ORDER BY sort_order, start_date DESC`,
        ),
      ]);
      return toProfile(profile, experiences.rows, education.rows);
    },

    async listProjects() {
      const result = await pool.query<ProjectRow>(
        `SELECT ${PROJECT_COLUMNS} FROM projects ${PROJECT_DISPLAY_ORDER}`,
      );
      return result.rows.map(toProjectSummary);
    },

    async findProjectBySlug(slug) {
      const result = await pool.query<ProjectRow>(
        `SELECT ${PROJECT_COLUMNS} FROM projects WHERE slug = $1`,
        [slug],
      );
      const row = result.rows[0];
      return row ? toProject(row) : null;
    },

    async replaceAll(content) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await upsertProfile(client, content.profile);
          await replaceExperiences(client, content.experiences);
          await replaceEducation(client, content.education);
          await replaceProjects(client, content.projects);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } finally {
        client.release();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Row → API mapping. Only the fields the API exposes are copied; internal columns such as
// sort_order and created_at stay behind.
// ---------------------------------------------------------------------------------------------

function toProfile(
  row: ProfileRow,
  experiences: ExperienceRow[],
  education: EducationRow[],
): Profile {
  return {
    fullName: row.full_name,
    headline: row.headline,
    summary: row.summary,
    location: row.location,
    links: row.links,
    experiences: experiences.map(toExperience),
    education: education.map(toEducation),
  };
}

function toExperience(row: ExperienceRow): Experience {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    startDate: row.start_date,
    endDate: row.end_date,
    highlights: row.highlights,
  };
}

function toEducation(row: EducationRow): Education {
  return {
    id: row.id,
    institution: row.institution,
    qualification: row.qualification,
    startDate: row.start_date,
    endDate: row.end_date,
    highlights: row.highlights,
  };
}

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    techStack: row.tech_stack,
    repoUrl: row.repo_url,
    liveUrl: row.live_url,
    featured: row.featured,
  };
}

function toProject(row: ProjectRow): Project {
  return { ...toProjectSummary(row), description: row.description, sections: row.sections };
}

// ---------------------------------------------------------------------------------------------
// Writes (content:seed)
// ---------------------------------------------------------------------------------------------

async function upsertProfile(client: PoolClient, profile: PortfolioContent['profile']) {
  await client.query(
    `INSERT INTO profile (id, full_name, headline, summary, location, links)
     VALUES (1, $1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           headline  = EXCLUDED.headline,
           summary   = EXCLUDED.summary,
           location  = EXCLUDED.location,
           links     = EXCLUDED.links,
           updated_at = now()`,
    [
      profile.fullName,
      profile.headline,
      profile.summary,
      profile.location,
      JSON.stringify(profile.links),
    ],
  );
}

/**
 * Experiences have no natural key, so they are replaced wholesale (their ids change on every
 * seed; they are only used as stable list keys within one response).
 */
async function replaceExperiences(
  client: PoolClient,
  experiences: PortfolioContent['experiences'],
) {
  await client.query('DELETE FROM experiences');
  for (const [sortOrder, experience] of experiences.entries()) {
    await client.query(
      `INSERT INTO experiences (company, role, start_date, end_date, highlights, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        experience.company,
        experience.role,
        experience.startDate,
        experience.endDate,
        experience.highlights,
        sortOrder,
      ],
    );
  }
}

/** Education, like experiences, has no natural key and is replaced wholesale. */
async function replaceEducation(client: PoolClient, education: PortfolioContent['education']) {
  await client.query('DELETE FROM education');
  for (const [sortOrder, entry] of education.entries()) {
    await client.query(
      `INSERT INTO education
         (institution, qualification, start_date, end_date, highlights, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.institution,
        entry.qualification,
        entry.startDate,
        entry.endDate,
        entry.highlights,
        sortOrder,
      ],
    );
  }
}

/** Projects are upserted by slug (keeping their id and created_at); missing slugs are deleted. */
async function replaceProjects(client: PoolClient, projects: PortfolioContent['projects']) {
  for (const [sortOrder, project] of projects.entries()) {
    await client.query(
      `INSERT INTO projects
         (slug, title, summary, description, tech_stack, repo_url, live_url, featured, sections,
          sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (slug) DO UPDATE
         SET title       = EXCLUDED.title,
             summary     = EXCLUDED.summary,
             description = EXCLUDED.description,
             tech_stack  = EXCLUDED.tech_stack,
             repo_url    = EXCLUDED.repo_url,
             live_url    = EXCLUDED.live_url,
             featured    = EXCLUDED.featured,
             sections    = EXCLUDED.sections,
             sort_order  = EXCLUDED.sort_order,
             updated_at  = now()`,
      [
        project.slug,
        project.title,
        project.summary,
        project.description,
        project.techStack,
        project.repoUrl,
        project.liveUrl,
        project.featured,
        JSON.stringify(project.sections),
        sortOrder,
      ],
    );
  }

  const slugs = projects.map((project) => project.slug);
  await client.query('DELETE FROM projects WHERE slug <> ALL($1::text[])', [slugs]);
}
