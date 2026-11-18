'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ScrollProgressBar } from './scroll-progress-bar';

/** Sections of the home page, in page order. Each is a `<section id="…">`. */
export const SECTIONS = [
  { id: 'about', label: 'about' },
  { id: 'experience', label: 'experience' },
  { id: 'projects', label: 'projects' },
  { id: 'lab', label: 'lab' },
  { id: 'contact', label: 'contact' },
] as const;

/**
 * Sticky header: name, section links (highlighting the one you are reading), a menu button on
 * small screens, and the scroll progress bar.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [active, setActive] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // "Scrollspy": the section crossing the middle of the screen is the one being read.
  useEffect(() => {
    if (pathname !== '/') {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    for (const { id } of SECTIONS) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => {
      observer.disconnect();
    };
  }, [pathname]);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const linkClass = (id: string) =>
    `rounded px-2 py-1 transition-colors hover:text-emerald-300 ${
      pathname === '/' && active === id ? 'text-emerald-400' : 'text-zinc-400'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-canvas/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="font-mono text-sm text-zinc-100"
          onClick={() => {
            setMenuOpen(false);
          }}
        >
          <span className="text-emerald-400">~/</span>yicheng
        </Link>

        <nav aria-label="Sections" className="hidden font-mono text-sm md:block">
          <ul className="flex items-center gap-1">
            {SECTIONS.map(({ id, label }) => (
              <li key={id}>
                <Link href={`/#${id}`} className={linkClass(id)}>
                  <span className="text-zinc-600">./</span>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <button
          type="button"
          className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-xs text-zinc-300 md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
        >
          {menuOpen ? 'close' : 'menu'}
        </button>
      </div>

      {menuOpen && (
        <nav id="mobile-menu" aria-label="Sections" className="border-t border-white/5 md:hidden">
          <ul className="mx-auto flex max-w-6xl flex-col px-4 py-2 font-mono text-sm">
            {SECTIONS.map(({ id, label }) => (
              <li key={id}>
                <Link
                  href={`/#${id}`}
                  className={`block py-2.5 ${linkClass(id)}`}
                  onClick={() => {
                    setMenuOpen(false);
                  }}
                >
                  <span className="text-zinc-600">./</span>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <ScrollProgressBar />
    </header>
  );
}
