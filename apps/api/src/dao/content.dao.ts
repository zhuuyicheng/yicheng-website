import type { ProfileLink, ProjectSection } from '../schema/content.schema.js';

/**
 * Row types: one per table, column for column, as defined in migrations 0001, 0002, 0006 and
 * 0008.
 * The DAL reads rows in exactly this shape and maps them to the API types in `schema/`, so
 * database naming (`snake_case`) never leaks into responses.
 *
 * DATE columns are typed as `'YYYY-MM-DD'` strings: the DAL selects them with `to_char`,
 * because pg would otherwise turn a DATE into a JS Date at local midnight (timezone bugs).
 * TIMESTAMPTZ columns arrive as JS Dates, which is safe because they carry a timezone.
 */

/** `profile`: always exactly one row (`id = 1`) once content is seeded. */
export interface ProfileRow {
  id: number;
  full_name: string;
  headline: string;
  summary: string;
  location: string | null;
  /** JSONB, parsed by pg. */
  links: ProfileLink[];
  updated_at: Date;
  /** When any content last changed (migration 0008): the home page's "Last updated" date. */
  content_updated_at: Date;
}

/** `experiences`: one row per job, shown in `sort_order`. */
export interface ExperienceRow {
  id: string;
  company: string;
  role: string;
  start_date: string;
  /** `null` = current role. */
  end_date: string | null;
  highlights: string[];
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/** `education`: one row per qualification, shown in `sort_order`. */
export interface EducationRow {
  id: string;
  institution: string;
  qualification: string;
  start_date: string;
  /** `null` = still studying. */
  end_date: string | null;
  highlights: string[];
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/** `projects`: one row per project, identified in URLs by `slug`. */
export interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  tech_stack: string[];
  repo_url: string | null;
  live_url: string | null;
  featured: boolean;
  /** JSONB (migration 0006), written only by content:seed after validation. */
  sections: ProjectSection[];
  sort_order: number;
  created_at: Date;
  /** Moves only when the seed changes this row (a new position counts): the page's date. */
  updated_at: Date;
}
