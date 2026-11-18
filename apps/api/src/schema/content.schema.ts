import { z } from 'zod';
import { projectSlugSchema } from '@portfolio/shared';

/**
 * Portfolio content: the profile (with work experience) and projects. See DESIGN.md §7.4.
 *
 * Two families of schemas:
 *   1. API shapes: what the endpoints return. They are the public contract, so they live in
 *      `@portfolio/shared` (re-exported here). Also used to validate entries read back from
 *      the Redis cache, so a corrupt or outdated entry is detected instead of served.
 *   2. The content file: what `content/portfolio.json` must contain. Stricter, because it
 *      is hand-edited and is the only way content gets into the database. API-only.
 */

export {
  educationSchema,
  experienceSchema,
  profileSchema,
  projectListSchema,
  projectSchema,
  projectSlugSchema,
  projectSummarySchema,
  type Education,
  type Experience,
  type Profile,
  type ProfileLink,
  type Project,
  type ProjectSummary,
} from '@portfolio/shared';

export const projectParamsSchema = z.object({ slug: projectSlugSchema });

// ---------------------------------------------------------------------------------------------
// 2. Content file (content/portfolio.json)
// ---------------------------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
const webUrl = z.url({ protocol: /^https?$/ });
const isoDate = z.iso.date(); // YYYY-MM-DD

const contentLinkSchema = z.object({ label: text(50), url: webUrl });

/** Shared rule for anything with a date range (mirrors the SQL `*_dates_ordered` CHECKs). */
const datesInOrder = {
  check: (entry: { startDate: string; endDate: string | null }) =>
    entry.endDate === null || entry.endDate >= entry.startDate,
  params: { message: 'must not be before startDate', path: ['endDate'] },
};

const contentProfileSchema = z.object({
  fullName: text(100),
  headline: text(200),
  summary: text(2_000),
  location: text(100).nullable().default(null),
  links: z.array(contentLinkSchema).default([]),
});

const contentExperienceSchema = z
  .object({
    company: text(200),
    role: text(200),
    startDate: isoDate,
    endDate: isoDate.nullable().default(null),
    highlights: z.array(text(500)).default([]),
  })
  .refine(datesInOrder.check, datesInOrder.params);

const contentEducationSchema = z
  .object({
    institution: text(200),
    qualification: text(200),
    startDate: isoDate,
    endDate: isoDate.nullable().default(null),
    highlights: z.array(text(500)).default([]),
  })
  .refine(datesInOrder.check, datesInOrder.params);

const contentProjectSchema = z.object({
  slug: projectSlugSchema,
  title: text(200),
  summary: text(500),
  description: text(10_000),
  techStack: z.array(text(50)).default([]),
  repoUrl: webUrl.nullable().default(null),
  liveUrl: webUrl.nullable().default(null),
  featured: z.boolean().default(false),
});

export const portfolioContentSchema = z.object({
  profile: contentProfileSchema,
  // Array order is display order: it becomes `sort_order` in the database.
  experiences: z.array(contentExperienceSchema),
  education: z.array(contentEducationSchema).default([]),
  projects: z.array(contentProjectSchema).superRefine((projects, context) => {
    const seen = new Set<string>();
    projects.forEach((project, index) => {
      if (seen.has(project.slug)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate slug "${project.slug}"`,
          path: [index, 'slug'],
        });
      }
      seen.add(project.slug);
    });
  }),
});

/** Validated content file, with defaults applied. */
export type PortfolioContent = z.infer<typeof portfolioContentSchema>;
