'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger siblings: each starts a little later (ms). */
  delayMs?: number;
}

/**
 * Fades its content in when it scrolls into view. It's visible in the server HTML and only
 * hidden after load, so without JavaScript or with reduced motion everything is just there.
 * Uses a `data-reveal` attribute and CSS, so scrolling never re-renders.
 */
export function Reveal({ children, className, delayMs = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    if (element.getBoundingClientRect().top < window.innerHeight * 0.9) {
      return undefined; // already on screen: leave it, no flash
    }

    element.dataset.reveal = 'hidden';
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          element.dataset.reveal = 'shown';
          observer.disconnect(); // once is enough
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const style =
    delayMs > 0 ? ({ '--reveal-delay': `${String(delayMs)}ms` } as CSSProperties) : undefined;
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
