'use client';

import { Menu, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import avatar from '@/content/photos/avatar.jpg';
import { browserTopEnvironment, scrollToPageTop } from '@/lib/section-scroll';
import { ScrollProgressBar } from './scroll-progress-bar';
import { SectionLink } from './section-link';
import { useScrollSpy } from './use-scroll-spy';

/** Sections of the home page, in page order. Each is a `<section id="…">`. */
export const SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'experience', label: 'Experience' },
  { id: 'projects', label: 'Projects' },
  { id: 'life', label: 'Outside work' },
  { id: 'contact', label: 'Contact' },
] as const;

/** Module-level, so the scrollspy's observer is built once, not on every render. */
const SECTION_IDS = SECTIONS.map((section) => section.id);

/**
 * Sticky header: photo and name, section links (highlighting the one you are reading), a menu
 * button on small screens, and the scroll progress bar. Section links scroll on every click
 * (components/section-link.tsx).
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // The section crossing the middle of the screen is the one being read; none above "About".
  const active = useScrollSpy(SECTION_IDS, '-45% 0px -50% 0px', pathname === '/');

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
    `rounded-full px-3 py-1.5 transition-colors hover:text-brand ${
      pathname === '/' && active === id ? 'text-brand' : 'text-muted'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          prefetch={false} // why: section-link.tsx
          className="flex items-center gap-3 font-display text-lg font-semibold tracking-tight text-ink"
          onClick={(event) => {
            setMenuOpen(false);
            // Already on the home page, <Link href="/"> would do nothing: scroll up instead.
            const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
            if (pathname === '/' && !modified) {
              event.preventDefault();
              scrollToPageTop(browserTopEnvironment());
            }
          }}
        >
          {/* Decorative: the name next to it says who it is. */}
          <Image
            src={avatar}
            alt=""
            width={36}
            height={36}
            priority
            className="size-9 rounded-full ring-2 ring-brand-soft"
          />
          Zhu Yicheng
        </Link>

        <nav aria-label="Sections" className="hidden text-sm md:block">
          <ul className="flex items-center gap-1">
            {SECTIONS.map(({ id, label }) => (
              <li key={id}>
                <SectionLink id={id} className={linkClass(id)}>
                  {label}
                </SectionLink>
              </li>
            ))}
          </ul>
        </nav>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs text-body md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
        >
          {menuOpen ? (
            <X aria-hidden className="size-3.5" />
          ) : (
            <Menu aria-hidden className="size-3.5" />
          )}
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {menuOpen && (
        <nav id="mobile-menu" aria-label="Sections" className="border-t border-line md:hidden">
          <ul className="mx-auto flex max-w-6xl flex-col px-4 py-2 text-sm">
            {SECTIONS.map(({ id, label }) => (
              <li key={id}>
                <SectionLink
                  id={id}
                  className={`block py-2.5 ${linkClass(id)}`}
                  onNavigate={() => {
                    setMenuOpen(false);
                  }}
                >
                  {label}
                </SectionLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <ScrollProgressBar />
    </header>
  );
}
