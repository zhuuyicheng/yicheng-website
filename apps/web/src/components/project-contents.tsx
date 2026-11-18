'use client';

import { useEffect, useState } from 'react';

export interface ContentsItem {
  id: string;
  heading: string;
}

/**
 * "On this page" for a project: links to each section, highlighting the one being read (the
 * section crossing the upper part of the screen). Without JavaScript the links still work.
 */
export function ProjectContents({ items }: { items: ContentsItem[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const { id } of items) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => {
      observer.disconnect();
    };
  }, [items]);

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">On this page</p>
      <ol className="border-l border-line">
        {items.map(({ id, heading }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? 'location' : undefined}
              className={`-ml-px block border-l-2 py-1.5 pl-4 transition-colors ${
                active === id
                  ? 'border-brand text-ink'
                  : 'border-transparent text-muted hover:text-body'
              }`}
            >
              {heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
