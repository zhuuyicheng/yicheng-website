import type { PoolClient } from 'pg';
import type { PostgresPool } from '../infra/postgres.js';
import type {
  PortfolioContent,
  Profile,
  ProfileLink,
  Experience,
  Project,
  ProjectSummary,
} from '../models/content.model.js';

/** All SQL for portfolio content. Reads serve the API; `replaceAll` serves `content:seed`. */
export interface ContentRepository {
  /** `null` until content has been seeded. */
  findProfile: () => Promise<Profile | null>;
  listProjects: () => Promise<ProjectSummary[]>;
  findProjectBySlug: (slug: string) => Promise<Project | null>;
  /** Makes the database match `content` exactly, in one transaction. */
  replaceAll: (content: PortfolioContent) => Promise<void>;
}

// Columns are aliased to camelCase so rows already have the API shape. Dates are formatted in
// SQL because pg would otherwise turn a DATE into a JS Date at local midnight (timezone bugs).
const PROJECT_SUMMARY_COLUMNS = `
  slug, title, summary, tech_stack AS "techStack", repo_url AS "repoUrl",
  live_url AS "liveUrl", featured`;

const PROJECT_DISPLAY_ORDER = 'ORDER BY featured DESC, sort_order, slug';

export function createContentRepository(pool: PostgresPool): ContentRepository {
  return {
    async findProfile() {
      const profiles = await pool.query<Omit<Profile, 'experiences'> & { links: ProfileLink[] }>(
        `SELECT full_name AS "fullName", headline, summary, location, links
           FROM profile
          WHERE id = 1`,
      );
      const profile = profiles.rows[0];
      if (!profile) {
        return null;
      }

      const experiences = await pool.query<Experience>(
        `SELECT id, company, role,
                to_char(start_date, 'YYYY-MM-DD') AS "startDate",
                to_char(end_date, 'YYYY-MM-DD')   AS "endDate",
                highlights
           FROM experiences
          ORDER BY sort_order, start_date DESC`,
      );
      return { ...profile, experiences: experiences.rows };
    },

    async listProjects() {
      const result = await pool.query<ProjectSummary>(
        `SELECT ${PROJECT_SUMMARY_COLUMNS} FROM projects ${PROJECT_DISPLAY_ORDER}`,
      );
      return result.rows;
    },

    async findProjectBySlug(slug) {
      const result = await pool.query<Project>(
        `SELECT ${PROJECT_SUMMARY_COLUMNS}, description FROM projects WHERE slug = $1`,
        [slug],
      );
      return result.rows[0] ?? null;
    },

    async replaceAll(content) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await upsertProfile(client, content.profile);
          await replaceExperiences(client, content.experiences);
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

/** Projects are upserted by slug (keeping their id and created_at); missing slugs are deleted. */
async function replaceProjects(client: PoolClient, projects: PortfolioContent['projects']) {
  for (const [sortOrder, project] of projects.entries()) {
    await client.query(
      `INSERT INTO projects
         (slug, title, summary, description, tech_stack, repo_url, live_url, featured, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (slug) DO UPDATE
         SET title       = EXCLUDED.title,
             summary     = EXCLUDED.summary,
             description = EXCLUDED.description,
             tech_stack  = EXCLUDED.tech_stack,
             repo_url    = EXCLUDED.repo_url,
             live_url    = EXCLUDED.live_url,
             featured    = EXCLUDED.featured,
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
        sortOrder,
      ],
    );
  }

  const slugs = projects.map((project) => project.slug);
  await client.query('DELETE FROM projects WHERE slug <> ALL($1::text[])', [slugs]);
}
