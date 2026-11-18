'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger siblings: each one starts a little later (ms). */
  delayMs?: number;
}

/**
 * Fades and slides its content in when it scrolls into view.
 *
 * Content is visible in the server-rendered HTML. Only after the page loads does this hide
 * what is still below the screen, then reveal it on arrival. So without JavaScript, for
 * search engines, or with "reduce motion" switched on, everything is simply there.
 *
 * It writes a `data-reveal` attribute instead of using React state: the animation is pure CSS
 * (globals.css), and scrolling never re-renders anything.
 */
export function Reveal({ children, className, delayMs = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    if (element.getBoundingClientRect().top < window.innerHeight * 0.9) {
      return undefined; // already on screen at load: leave it alone, no flash
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
