'use client';

import { useEffect, useState } from 'react';

interface TypedTextProps {
  text: string;
  /** Milliseconds per character. */
  speedMs?: number;
  startDelayMs?: number;
  className?: string;
}

/**
 * Types `text` out like a terminal command, with a blinking cursor.
 *
 * The typed copy starts empty on the server and in the browser alike (they must render the
 * same HTML, or React reports a hydration mismatch). The full text is always in the page for
 * screen readers and search engines (`sr-only`); the animated copy is `aria-hidden`. With
 * "reduce motion" on, it appears at once.
 */
export function TypedText({ text, speedMs = 70, startDelayMs = 300, className }: TypedTextProps) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = window.setTimeout(() => {
        setShown(text.length);
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }

    let count = 0;
    let timer = window.setTimeout(function tick() {
      count += 1;
      setShown(count);
      if (count < text.length) {
        timer = window.setTimeout(tick, speedMs);
      }
    }, startDelayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, speedMs, startDelayMs]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, shown)}</span>
      <span aria-hidden className="cursor-blink ml-0.5 inline-block w-[0.6ch] bg-emerald-400">
        &nbsp;
      </span>
    </span>
  );
}
