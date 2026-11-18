'use client';

import { useState, type PointerEvent } from 'react';
import { linePath, niceCeiling } from '@/lib/status';

interface LiveChartProps {
  title: string;
  /** One value per sample, oldest first; `null` = no data at that moment. */
  values: readonly (number | null)[];
  /** Sample times (ms since epoch), same length as `values`. */
  times: readonly number[];
  format: (value: number | null) => string;
}

const WIDTH = 600;
const HEIGHT = 140;
const TIME = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * One measure over the minutes the page has been open: a 2 px line, a recessive grid with the
 * scale's top value, and a crosshair + tooltip on hover or touch. One series per chart (never two
 * y-axes); the title names it, so no legend is needed.
 */
export function LiveChart({ title, values, times, format }: LiveChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const ceiling = niceCeiling(values);
  const path = linePath(values, WIDTH, HEIGHT, ceiling);
  const latest = values.at(-1) ?? null;

  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (values.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    setHover(Math.round(Math.min(1, Math.max(0, fraction)) * (values.length - 1)));
  };

  const hoverValue = hover === null ? undefined : values[hover];
  const hoverTime = hover === null ? undefined : times[hover];
  const hoverX =
    hover === null || values.length < 2 ? WIDTH / 2 : (hover / (values.length - 1)) * WIDTH;
  const hoverY =
    hoverValue === undefined || hoverValue === null
      ? null
      : HEIGHT - (Math.min(hoverValue, ceiling) / ceiling) * HEIGHT;

  return (
    <figure className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 sm:p-5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs text-zinc-400">{title}</span>
        <span className="font-mono text-sm text-zinc-100">{format(latest)}</span>
      </figcaption>

      <div className="relative mt-4">
        <span className="absolute -top-1 left-0 font-mono text-[10px] text-zinc-600">
          {format(ceiling)}
        </span>
        <svg
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          preserveAspectRatio="none"
          className="h-32 w-full touch-none overflow-visible"
          role="img"
          aria-label={`${title}: latest ${format(latest)}, ${String(values.length)} samples`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => {
            setHover(null);
          }}
        >
          {[0.5, 1].map((level) => (
            <line
              key={level}
              x1={0}
              x2={WIDTH}
              y1={HEIGHT - level * HEIGHT}
              y2={HEIGHT - level * HEIGHT}
              className="stroke-white/5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={0}
            x2={WIDTH}
            y1={HEIGHT}
            y2={HEIGHT}
            className="stroke-white/15"
            vectorEffect="non-scaling-stroke"
          />
          {path && (
            <path
              d={path}
              fill="none"
              className="stroke-emerald-400"
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
              className="stroke-zinc-500"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* The marker is HTML, so it stays round although the SVG stretches. */}
        {hoverY !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400 ring-2 ring-canvas"
            style={{
              left: `${String((hoverX / WIDTH) * 100)}%`,
              top: `${String((hoverY / HEIGHT) * 100)}%`,
            }}
          />
        )}
        {hover !== null && hoverTime !== undefined && (
          <div
            className={`pointer-events-none absolute -top-9 rounded border border-white/10 bg-zinc-950/95 px-2 py-1 font-mono text-[11px] whitespace-nowrap text-zinc-200 ${
              hoverX > WIDTH / 2 ? '-translate-x-full' : ''
            }`}
            style={{ left: `${String((hoverX / WIDTH) * 100)}%` }}
          >
            {format(hoverValue ?? null)}{' '}
            <span className="text-zinc-500">· {TIME.format(hoverTime)}</span>
          </div>
        )}
        {values.length < 2 && (
          <p className="absolute inset-0 flex items-center justify-center font-mono text-xs text-zinc-600">
            collecting samples…
          </p>
        )}
      </div>
    </figure>
  );
}
