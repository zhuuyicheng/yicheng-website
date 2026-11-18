'use client';

import { useState, type PointerEvent } from 'react';
import {
  CHART_TICK_MS,
  formatClock,
  nearestPoint,
  niceCeiling,
  timeLinePath,
  timeTicks,
  timeX,
  type TimePoint,
} from '@/lib/status';

interface LiveChartProps {
  title: string;
  /** Oldest first; `value: null` = no data at that moment. */
  points: readonly TimePoint[];
  /** The right edge of the time axis (now); the axis covers `windowMs` before it. */
  end: number;
  windowMs: number;
  /** Longest pause between samples that is still drawn as one line. */
  maxGapMs: number;
  format: (value: number | null) => string;
}

const WIDTH = 600;
const HEIGHT = 140;
const TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * One measure over the last `windowMs`, placed by time: a 2 px line, a recessive grid with
 * the scale's top value, a labelled tick every 5 minutes, and a crosshair + tooltip on hover
 * or touch. One series per chart (never two y-axes); the title names it, so no legend.
 */
export function LiveChart({ title, points, end, windowMs, maxGapMs, format }: LiveChartProps) {
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const scale = { start: end - windowMs, end, width: WIDTH };
  const visible = points.filter((point) => point.at >= scale.start);
  const ceiling = niceCeiling(visible.map((point) => point.value));
  const path = timeLinePath(visible, { ...scale, height: HEIGHT, ceiling, maxGapMs });
  const ticks = timeTicks(scale.start, scale.end, CHART_TICK_MS);
  const latest = visible.at(-1)?.value ?? null;

  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverAt(scale.start + fraction * windowMs);
  };

  const hover = hoverAt === null ? null : nearestPoint(visible, hoverAt);
  const hoverX = hover === null ? 0 : timeX(hover.at, scale);
  const hoverValue = hover?.value ?? null;
  const hoverY =
    hoverValue === null ? null : HEIGHT - (Math.min(hoverValue, ceiling) / ceiling) * HEIGHT;
  const percent = (x: number) => `${String((x / WIDTH) * 100)}%`;

  return (
    <figure className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted">{title}</span>
        <span className="text-sm text-ink tabular-nums">{format(latest)}</span>
      </figcaption>

      <div className="relative mt-4">
        <span className="absolute -top-1 left-0 text-[10px] text-faint tabular-nums">
          {format(ceiling)}
        </span>
        <svg
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          preserveAspectRatio="none"
          className="h-32 w-full touch-none overflow-visible"
          role="img"
          aria-label={`${title}, last ${String(windowMs / 60_000)} minutes: latest ${format(latest)}`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => {
            setHoverAt(null);
          }}
        >
          {ticks.map((at) => (
            <line
              key={at}
              x1={timeX(at, scale)}
              x2={timeX(at, scale)}
              y1={0}
              y2={HEIGHT}
              className="stroke-line"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {[0.5, 1].map((level) => (
            <line
              key={level}
              x1={0}
              x2={WIDTH}
              y1={HEIGHT - level * HEIGHT}
              y2={HEIGHT - level * HEIGHT}
              className="stroke-line"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={0}
            x2={WIDTH}
            y1={HEIGHT}
            y2={HEIGHT}
            className="stroke-line-strong"
            vectorEffect="non-scaling-stroke"
          />
          {path && (
            <path
              d={path}
              fill="none"
              className="stroke-brand"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {hover !== null && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={0}
              y2={HEIGHT}
              className="stroke-faint"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* The marker is HTML, so it stays round although the SVG stretches. */}
        {hoverY !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-surface"
            style={{ left: percent(hoverX), top: `${String((hoverY / HEIGHT) * 100)}%` }}
          />
        )}
        {hover !== null && (
          <div
            className={`pointer-events-none absolute -top-9 rounded bg-ink px-2 py-1 text-[11px] whitespace-nowrap text-white tabular-nums shadow-md ${
              hoverX > WIDTH / 2 ? '-translate-x-full' : ''
            }`}
            style={{ left: percent(hoverX) }}
          >
            {format(hover.value)} <span className="text-white/70">· {TIME.format(hover.at)}</span>
          </div>
        )}
        {visible.length < 2 && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-faint">
            Collecting samples…
          </p>
        )}

        {/* The time axis: a label under every 5-minute tick, inside the figure's height. */}
        <div aria-hidden className="relative mt-2 h-4 text-[10px] text-muted tabular-nums">
          {ticks.map((at) => {
            const x = timeX(at, scale);
            // Too close to an edge, a centred label would stick out of the card.
            if (x < WIDTH * 0.04 || x > WIDTH * 0.96) return null;
            return (
              <span key={at} className="absolute -translate-x-1/2" style={{ left: percent(x) }}>
                {formatClock(at)}
              </span>
            );
          })}
        </div>
      </div>
    </figure>
  );
}
