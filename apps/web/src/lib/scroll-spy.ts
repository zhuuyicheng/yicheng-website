/**
 * "Scrollspy": which section is being read, for the header's links and a project page's
 * "On this page" list (components/use-scroll-spy.ts). No React, so it can be unit-tested.
 *
 * IntersectionObserver reports each section entering or leaving a band across the screen.
 * The set of sections inside the band is kept up to date from those reports, and the one being
 * read is the first of them in page order, or none. "None" matters: above the first section
 * (the hero) nothing is being read, so nothing should stay highlighted.
 */

export interface BandChange {
  id: string;
  isIntersecting: boolean;
}

/** The sections inside the band after `changes` (a new set; the old one is left alone). */
export function updateVisible(
  visible: ReadonlySet<string>,
  changes: readonly BandChange[],
): Set<string> {
  const next = new Set(visible);
  for (const change of changes) {
    if (change.isIntersecting) {
      next.add(change.id);
    } else {
      next.delete(change.id);
    }
  }
  return next;
}

/** The first section of `order` that is inside the band, or `null` when none is. */
export function activeSection(
  visible: ReadonlySet<string>,
  order: readonly string[],
): string | null {
  return order.find((id) => visible.has(id)) ?? null;
}
