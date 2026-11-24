import type { ProjectSection } from '../schema/content.schema.js';

/** One entry of `profile.links` as the seed stored it; older seeds have no `text`. */
export interface StoredLink {
  label: string;
  url: string;
  text?: string;
}

/**
 * Content tables (migrations 0001, 0002, 0006, 0008), column for column. DATE columns are
 * `'YYYY-MM-DD'` strings (selected with to_char): pg would make them local-midnight Dates.
 */

/** `profile`: exactly one row (`id = 1`) once seeded. */
export interface ProfileRow {
  id: number;
  full_name: string;
  headline: string;
  summary: string;
  location: string | null;
  /** JSONB, parsed by pg. */
  links: StoredLink[];
  updated_at: Date;
  /** When any content last changed: the home page's "Last updated". */
  content_updated_at: Date;
}

/** `experiences`: one row per job, in `sort_order`. */
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

/** `education`: one row per qualification, in `sort_order`. */
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

/** `projects`: one per project, `slug` in its URL. */
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
  /** JSONB, written only by content:seed after validation. */
  sections: ProjectSection[];
  sort_order: number;
  created_at: Date;
  /** Moves only when the seed changes this row (a new position counts): the page's date. */
  updated_at: Date;
}
