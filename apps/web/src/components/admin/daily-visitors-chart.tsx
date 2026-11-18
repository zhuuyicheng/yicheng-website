'use client';

import type { VisitorSummary } from '@portfolio/shared';
import { useState } from 'react';
import { niceCeiling } from '@/lib/status';
import { formatDay } from '@/lib/visitors';

type Day = VisitorSummary['daily'][number];

/**
 * Unique visitors per (UTC) day as columns, with page views in the tooltip. One series, so
 * no legend: the title names it. A screen-reader table carries the same numbers.
 */
export function DailyVisitorsChart({ days }: { days: readonly Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ceiling = niceCeiling(days.map((day) => day.visitors));
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));
  const hovered = hover === null ? undefined : days[hover];

  return (
    <figure className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-body">Unique visitors per day</span>
        <span className="text-xs text-muted">UTC days</span>
      </figcaption>

      <div className="relative mt-7">
        <span className="absolute -top-5 left-0 text-[10px] text-faint tabular-nums">
          {ceiling}
        </span>
        <div
          aria-hidden
          className="flex h-36 items-end border-b border-line-strong"
          onPointerLeave={() => {
            setHover(null);
          }}
        >
          {days.map((day, index) => (
            // The whole column is the hover target, not just the (maybe tiny) bar.
            <div
              key={day.day}
              className="flex h-full flex-1 items-end justify-center px-px"
              onPointerEnter={() => {
                setHover(index);
              }}
              onPointerDown={() => {
                setHover(index);
              }}
            >
              <div
                className={`w-full max-w-6 rounded-t transition-colors ${
                  hover === index ? 'bg-brand-strong' : 'bg-brand'
                }`}
                style={{ height: `${String((day.visitors / ceiling) * 100)}%` }}
              />
            </div>
          ))}
        </div>

        {hover !== null && hovered !== undefined && (
          <div
            className={`pointer-events-none absolute -top-9 rounded bg-ink px-2 py-1 text-[11px] whitespace-nowrap text-white tabular-nums shadow-md ${
              hover > days.length / 2 ? '-translate-x-full' : ''
            }`}
            style={{ left: `${String(((hover + 0.5) / days.length) * 100)}%` }}
          >
            {formatDay(hovered.day)} · {hovered.visitors} visitors ·{' '}
            <span className="text-white/70">{hovered.pageViews} page views</span>
          </div>
        )}

        <div aria-hidden className="mt-2 flex text-[10px] text-muted">
          {days.map((day, index) => (
            <span key={day.day} className="flex-1 text-center whitespace-nowrap">
              {index % labelEvery === 0 || index === days.length - 1 ? formatDay(day.day) : ''}
            </span>
          ))}
        </div>
      </div>

      {/* sr-only on a wrapper, not the table: a table's caption sits outside the table's own
          box, so hiding the table alone left the caption visible. */}
      <div className="sr-only">
        <table>
          <caption>Unique visitors and page views per day</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>Visitors</th>
              <th>Page views</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day}>
                <td>{formatDay(day.day)}</td>
                <td>{day.visitors}</td>
                <td>{day.pageViews}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
