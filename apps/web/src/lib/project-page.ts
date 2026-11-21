import type { ProjectSummary } from '@portfolio/shared';

/**
 * URL-safe ids for a project page's section headings (`#how-it-works`), so the contents list
 * can link to them. Repeated headings get a number (`tools`, `tools-2`), so every id is unique.
 */
export function sectionAnchors(headings: readonly string[]): string[] {
  const used = new Map<string, number>();
  return headings.map((heading) => {
    const base =
      heading
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'section';
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${String(count)}`;
  });
}

/**
 * The project after `slug` in display order. `null` after the last one (the list ends there:
 * only "Back to projects" is offered, not a jump back to the first) or for an unknown slug.
 */
export function nextProject(
  projects: readonly ProjectSummary[],
  slug: string,
): ProjectSummary | null {
  const index = projects.findIndex((project) => project.slug === slug);
  if (index === -1) {
    return null;
  }
  return projects[index + 1] ?? null;
}
