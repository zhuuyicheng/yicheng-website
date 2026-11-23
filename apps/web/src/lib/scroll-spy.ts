/**
 * Which section is being read, for the header and "On this page" (components/use-scroll-spy.ts).
 * IntersectionObserver reports sections entering or leaving a band; the active one is the first
 * inside it, or none (above the first section nothing should stay highlighted).
 */

export interface BandChange {
  id: string;
  isIntersecting: boolean;
}

/** The sections in the band after `changes` (a new set). */
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

/** The first section of `order` inside the band, or `null`. */
export function activeSection(
  visible: ReadonlySet<string>,
  order: readonly string[],
): string | null {
  return order.find((id) => visible.has(id)) ?? null;
}
