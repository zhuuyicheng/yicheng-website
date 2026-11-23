'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { OWNER_BROWSER_KEY } from '@/lib/telemetry';

const CHANGED = 'portfolio:owner-browser';

/** `excluded` ("1"), `counted` ("0"), `unset`, `blocked` (no storage) or `unknown` (server). */
type Mark = 'excluded' | 'counted' | 'unset' | 'blocked' | 'unknown';

function readMark(): Mark {
  try {
    const value = window.localStorage.getItem(OWNER_BROWSER_KEY);
    if (value === '1') return 'excluded';
    if (value === '0') return 'counted';
    return 'unset';
  } catch {
    return 'blocked';
  }
}

function writeMark(value: '0' | '1'): void {
  try {
    window.localStorage.setItem(OWNER_BROWSER_KEY, value);
  } catch {
    // readMark() reports blocked storage, and the toggle says so.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onChange); // another tab changed it
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Keeps the owner's browsing out of the numbers: opening /admin marks this browser (unless
 * turned off), and the beacon then sends nothing from it.
 */
export function OwnerBrowserToggle() {
  const mark = useSyncExternalStore(subscribe, readMark, (): Mark => 'unknown');

  useEffect(() => {
    if (readMark() === 'unset') {
      writeMark('1');
    }
  }, []);

  if (mark === 'blocked') {
    return (
      <p className="text-xs text-amber-700">
        This browser blocks local storage, so your own visits from it are counted.
      </p>
    );
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <input
        type="checkbox"
        className="size-4 accent-brand"
        checked={mark === 'excluded'}
        disabled={mark === 'unknown' || mark === 'unset'}
        onChange={(event) => {
          writeMark(event.target.checked ? '1' : '0');
        }}
      />
      Don&apos;t count my visits from this browser
    </label>
  );
}
