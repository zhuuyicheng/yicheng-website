'use client';

import { useEffect, useRef } from 'react';

/** A thin bar under the header that fills as you scroll down the page. */
export function ScrollProgressBar() {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
      // transform, not width: the browser can animate it without recalculating the layout.
      bar.current?.style.setProperty('transform', `scaleX(${String(progress)})`);
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
  }, []);

  return (
    <div
      ref={bar}
      aria-hidden
      className="h-0.5 w-full origin-left scale-x-0 bg-gradient-to-r from-brand via-brand-strong to-brand"
    />
  );
}
