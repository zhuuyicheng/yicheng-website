'use client';

import type { Education, Experience } from '@portfolio/shared';
import { BriefcaseBusiness, GraduationCap } from 'lucide-react';
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
      <div aria-hidden className="absolute top-4 bottom-4 left-[17px] w-0.5 bg-line" />
      <div
        aria-hidden
        className="absolute top-4 bottom-4 left-[17px] w-0.5 origin-top bg-gradient-to-b from-brand to-moss [transform:scaleY(var(--progress,1))]"
      />

      <ol className="space-y-12">
        {entries.map((entry) => (
          <li key={entry.item.id} className="relative pl-14">
            <span
              aria-hidden
              className={`absolute top-0 left-0 flex size-9 items-center justify-center rounded-full ring-4 ring-surface ${
                entry.kind === 'work' ? 'bg-brand-soft text-brand' : 'bg-moss-soft text-moss'
              }`}
            >
              {entry.kind === 'work' ? (
                <BriefcaseBusiness className="size-4" strokeWidth={1.75} />
              ) : (
                <GraduationCap className="size-4" strokeWidth={1.75} />
              )}
            </span>
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
      <p className="text-xs text-muted tabular-nums sm:text-sm">
        {formatRange(item.startDate, item.endDate)}
        <span className="block text-faint">{formatDuration(months)}</span>
      </p>
      <div className="mt-2 md:mt-0">
        <h3 className="font-display text-xl font-semibold text-ink">{title}</h3>
        <p className={`font-medium ${entry.kind === 'work' ? 'text-brand' : 'text-moss'}`}>
          {place}
        </p>
        {item.highlights.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted sm:text-base">
            {item.highlights.map((highlight) => (
              <li key={highlight} className="flex gap-3">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-faint" />
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
