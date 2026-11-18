'use client';

import { useRef, type ReactNode } from 'react';
import { useScrollProgress } from './use-scroll-progress';

/** How much of the element must have scrolled off the top before it starts fading. */
const FADE_START = 0.6;

/**
 * Fades out and drifts up a little as it scrolls off the top of the screen (the hero). It
 * stays fully visible until FADE_START of it has gone, then fades over the rest, so it is gone
 * only as it leaves. The motion is plain CSS driven by `--progress`, which useScrollProgress
 * updates while you scroll.
 */
export function ScrollFade({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollProgress(ref, 'leave');

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: `calc(1 - max(0, var(--progress, 0) - ${String(FADE_START)}) / ${String(1 - FADE_START)})`,
        transform: 'translateY(calc(var(--progress, 0) * -2rem))',
      }}
    >
      {children}
    </div>
  );
}
