'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Scroll-linked effects: writes `--progress` (0 → 1) on the element as it travels through the
 * viewport, and CSS turns that number into motion (`transform: scaleY(var(--progress))`).
 *
 *   - `through`: 0 when the element's top reaches the middle of the screen, 1 when its bottom
 *     does. For things that fill up while you read them (the experience timeline).
 *   - `leave`: 0 while the element is at the top of the page, 1 once it has scrolled out. For
 *     things that fade away as you scroll on (the hero).
 *
 * Why a CSS variable instead of React state: scroll events fire up to 120 times a second.
 * Updating one style property is cheap; re-rendering components that often is not. Updates
 * are batched to one per animation frame.
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
