import { z } from 'zod';

/**
 * Portfolio content as the API returns it (DESIGN.md §7.4): GET /api/v1/profile,
 * /api/v1/projects and /api/v1/projects/:slug. The API also validates entries read back from
 * its Redis cache with these, and the web app validates what it receives.
 */

/** Lowercase words joined by single hyphens, e.g. `telemetry-platform` (mirrors the SQL CHECK). */
export const projectSlugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase letters/digits separated by hyphens');

export const linkSchema = z.object({ label: z.string(), url: z.string() });

export const experienceSchema = z.object({
  id: z.string(),
  company: z.string(),
  role: z.string(),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string().nullable(), // null = current role
  highlights: z.array(z.string()),
});

export const educationSchema = z.object({
  id: z.string(),
  institution: z.string(),
  qualification: z.string(),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string().nullable(), // null = still studying
  highlights: z.array(z.string()),
});

export const profileSchema = z.object({
  fullName: z.string(),
  headline: z.string(),
  summary: z.string(),
  location: z.string().nullable(),
  links: z.array(linkSchema),
  experiences: z.array(experienceSchema),
  education: z.array(educationSchema),
  /**
   * When any published content last changed (this profile, an experience, an education entry
   * or a project, including removing one), e.g. `2026-11-21T09:30:00.000Z`. The home page's
   * "Last updated" date. A seed that changes nothing leaves it alone.
   */
  contentUpdatedAt: z.iso.datetime(),
});

export const projectSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  techStack: z.array(z.string()),
  repoUrl: z.string().nullable(),
  liveUrl: z.string().nullable(),
  featured: z.boolean(),
});

export const projectListSchema = z.array(projectSummarySchema);

/** One part of a project page: a heading, an optional explanation, and bullet points. */
export const projectSectionSchema = z.object({
  heading: z.string(),
  /** Paragraphs separated by a blank line, or `null`. */
  body: z.string().nullable(),
  points: z.array(z.string()),
});

export const projectSchema = projectSummarySchema.extend({
  description: z.string(),
  sections: z.array(projectSectionSchema),
  /** When this project last changed (a new position in the list counts): its page's date. */
  updatedAt: z.iso.datetime(),
});

export type ProfileLink = z.infer<typeof linkSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectSection = z.infer<typeof projectSectionSchema>;
export type Project = z.infer<typeof projectSchema>;
