import { z } from 'zod';

/**
 * Portfolio content: the profile (with work experience) and projects. See DESIGN.md §7.4.
 *
 * Two families of schemas live here:
 *   1. API shapes: what the endpoints return. Also used to validate entries read back from
 *      the Redis cache, so a corrupt or outdated entry is detected instead of served.
 *   2. The content file: what `content/portfolio.json` must contain. Stricter, because it
 *      is hand-edited and is the only way content gets into the database.
 */

/** Lowercase words joined by single hyphens, e.g. `telemetry-platform` (mirrors the SQL CHECK). */
export const projectSlugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase letters/digits separated by hyphens');

export const projectParamsSchema = z.object({ slug: projectSlugSchema });

// ---------------------------------------------------------------------------------------------
// 1. API shapes
// ---------------------------------------------------------------------------------------------

const linkSchema = z.object({ label: z.string(), url: z.string() });

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

export const projectSchema = projectSummarySchema.extend({ description: z.string() });

export type ProfileLink = z.infer<typeof linkSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type Project = z.infer<typeof projectSchema>;

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
