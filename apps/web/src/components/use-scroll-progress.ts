'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Writes `--progress` (0 → 1) on the element for CSS to animate. `through`: from its top to its
 * bottom crossing mid-screen (the timeline). `leave`: until it has scrolled out (the hero). A CSS
 * variable, not React state: scroll fires up to 120 times a second. One update per frame.
 */
export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
  mode: 'through' | 'leave',
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const viewport = window.innerHeight;
      const raw =
        mode === 'through'
          ? (viewport / 2 - rect.top) / Math.max(rect.height, 1)
          : -rect.top / Math.max(rect.height, 1);
      element.style.setProperty('--progress', String(Math.min(1, Math.max(0, raw))));
    };
    const onScroll = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ref, mode]);
}
