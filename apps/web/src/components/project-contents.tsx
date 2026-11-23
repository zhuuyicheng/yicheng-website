'use client';

import { useMemo } from 'react';
import { useScrollSpy } from './use-scroll-spy';

export interface ContentsItem {
  id: string;
  heading: string;
}

/** "On this page" for a project, highlighting the section being read. Works without JavaScript. */
export function ProjectContents({ items }: { items: ContentsItem[] }) {
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const active = useScrollSpy(ids, '-20% 0px -70% 0px');

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
