'use client';

import { useRef, type ReactNode } from 'react';
import { useScrollProgress } from './use-scroll-progress';

/**
 * Drifts up and fades out as it scrolls off the top of the screen (the hero). The motion is
 * plain CSS driven by `--progress`, which useScrollProgress updates while you scroll.
 */
export function ScrollFade({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollProgress(ref, 'leave');

  return (
    <div
      ref={ref}
      className={`[opacity:calc(1-var(--progress,0)*1.4)] [transform:translateY(calc(var(--progress,0)*-4rem))] ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
