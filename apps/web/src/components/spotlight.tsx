'use client';

import { useEffect, useRef } from 'react';

/**
 * A glow behind the hero that follows the mouse (globals.css `spotlight`). Only for precise
 * pointers: on phones and tablets there is no hovering finger to follow, so it stays centred.
 */
export function Spotlight({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    const area = element?.parentElement;
    if (!element || !area || !window.matchMedia('(pointer: fine)').matches) {
      return undefined;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    let frame = 0;
    let x = 0;
    let y = 0;
    const onMove = (event: PointerEvent) => {
      const rect = area.getBoundingClientRect();
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          element.style.setProperty('--mx', `${String(x)}px`);
          element.style.setProperty('--my', `${String(y)}px`);
        });
      }
    };
    area.addEventListener('pointermove', onMove);
    return () => {
      area.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className={`spotlight pointer-events-none ${className ?? ''}`} />
  );
}
