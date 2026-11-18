'use client';

import type { Education, Experience } from '@portfolio/shared';
import { useRef } from 'react';
import { formatDuration, formatRange, monthsBetween } from '@/lib/format';
import { Reveal } from './reveal';
import { useScrollProgress } from './use-scroll-progress';

type Entry = { kind: 'work'; item: Experience } | { kind: 'study'; item: Education };

/**
 * Work and education on one vertical line. The line fills with colour as you scroll through
 * it (`--progress`), and each entry slides in as it arrives.
 */
export function ExperienceTimeline({ entries }: { entries: Entry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollProgress(ref, 'through');

  return (
    <div ref={ref} className="relative">
      <div aria-hidden className="absolute top-2 bottom-2 left-[7px] w-px bg-zinc-800" />
      <div
        aria-hidden
        className="absolute top-2 bottom-2 left-[7px] w-px origin-top bg-gradient-to-b from-emerald-400 to-cyan-400 [transform:scaleY(var(--progress,1))]"
      />

      <ol className="space-y-12">
        {entries.map((entry) => (
          <li key={entry.item.id} className="relative pl-10">
            <span
              aria-hidden
              className={`absolute top-1.5 left-0 size-[15px] rounded-full border-2 bg-canvas ${
                entry.kind === 'work' ? 'border-emerald-400' : 'border-cyan-400'
              }`}
            />
            <Reveal>
              <TimelineEntry entry={entry} />
            </Reveal>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TimelineEntry({ entry }: { entry: Entry }) {
  const { item } = entry;
  const title = entry.kind === 'work' ? entry.item.role : entry.item.qualification;
  const place = entry.kind === 'work' ? entry.item.company : entry.item.institution;
  const months = monthsBetween(item.startDate, item.endDate);

  return (
    <article className="md:grid md:grid-cols-[11rem_1fr] md:gap-8">
      <p className="font-mono text-xs text-zinc-500 sm:text-sm">
        {formatRange(item.startDate, item.endDate)}
        <span className="block text-zinc-600">{formatDuration(months)}</span>
      </p>
      <div className="mt-2 md:mt-0">
        <h3 className="text-lg font-medium text-zinc-100">
          {title}
          <span className="text-zinc-500"> @ </span>
          <span className={entry.kind === 'work' ? 'text-emerald-300' : 'text-cyan-300'}>
            {place}
          </span>
        </h3>
        {item.highlights.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-400 sm:text-base">
            {item.highlights.map((highlight) => (
              <li key={highlight} className="flex gap-3">
                <span aria-hidden className="mt-1 font-mono text-xs text-emerald-500">
                  ▸
                </span>
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

export type { Entry as TimelineEntryData };
