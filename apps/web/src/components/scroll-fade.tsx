'use client';

import { useRef, type ReactNode } from 'react';
import { useScrollProgress } from './use-scroll-progress';

/** How much must have scrolled off the top before fading starts. */
const FADE_START = 0.6;

/** Fades and drifts up as it scrolls off the top (the hero), via `--progress` in CSS. */
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
