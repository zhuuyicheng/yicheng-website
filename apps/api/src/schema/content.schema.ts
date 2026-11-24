import { z } from 'zod';
import { projectSlugSchema } from '@portfolio/shared';

/**
 * Portfolio content (DESIGN.md §7.4): the API shapes (shared; also check cache entries) and
 * the stricter, API-only shape of the hand-edited content/portfolio.json.
 */

export {
  educationSchema,
  experienceSchema,
  profileSchema,
  projectListSchema,
  projectSchema,
  projectSectionSchema,
  projectSlugSchema,
  projectSummarySchema,
  type Education,
  type Experience,
  type Profile,
  type ProfileLink,
  type Project,
  type ProjectSection,
  type ProjectSummary,
} from '@portfolio/shared';

export const projectParamsSchema = z.object({ slug: projectSlugSchema });

// Content file (content/portfolio.json)

const text = (max: number) => z.string().trim().min(1).max(max);
const webUrl = z.url({ protocol: /^https?$/ });
const isoDate = z.iso.date(); // YYYY-MM-DD

/** `text`: what the page shows instead of the address (e.g. "View my LinkedIn profile"). */
const contentLinkSchema = z.object({ label: text(50), url: webUrl, text: text(80).optional() });

/** For anything with a date range (mirrors the SQL `*_dates_ordered` CHECKs). */
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

/** A section needs something under its heading: a paragraph, points, or both. */
const contentProjectSectionSchema = z
  .object({
    heading: text(120),
    body: text(2_000).nullable().default(null),
    points: z.array(text(500)).default([]),
  })
  .refine((section) => section.body !== null || section.points.length > 0, {
    message: 'needs a body or at least one point',
    path: ['points'],
  });

/** Projects live at `/<slug>`, so a slug can't take one of the site's own addresses. */
export const RESERVED_PROJECT_SLUGS = ['admin', 'projects', 'privacy'] as const;

const contentProjectSchema = z.object({
  slug: projectSlugSchema.refine(
    (slug) => !(RESERVED_PROJECT_SLUGS as readonly string[]).includes(slug),
    { message: 'is already a page of the site; choose another slug' },
  ),
  title: text(200),
  summary: text(500),
  description: text(10_000),
  techStack: z.array(text(50)).default([]),
  repoUrl: webUrl.nullable().default(null),
  liveUrl: webUrl.nullable().default(null),
  featured: z.boolean().default(false),
  sections: z.array(contentProjectSectionSchema).max(20).default([]),
});

export const portfolioContentSchema = z.object({
  profile: contentProfileSchema,
  // Array order is display order (`sort_order`).
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
