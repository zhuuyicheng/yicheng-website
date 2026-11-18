'use client';

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { simulate, windowAt } from '@/lib/sliding-window';

const TIMELINE_SECONDS = 60;
const DEMO_REQUESTS = [2, 4, 5.5, 7, 12, 21, 22, 22.8, 23.5, 24, 38, 44, 45, 52];
const PLAY_STEP_SECONDS = 0.25;
const PLAY_TICK_MS = 60;

const percent = (seconds: number) => `${String((seconds / TIMELINE_SECONDS) * 100)}%`;
const oneDecimal = (seconds: number) => (Math.round(seconds * 10) / 10).toFixed(1);

/**
 * An interactive version of the contact form's rate limiter (DESIGN.md §6.4), shrunk from
 * "3 per 10 minutes" to seconds so you can watch it work. Every dot is a request; the shaded
 * box is the window. Change the limit and window size, scrub or play the clock, or click the
 * track to send a request at that moment. The decisions come from lib/sliding-window.ts, the
 * same rule the API's Lua script applies.
 */
export function SlidingWindowLab() {
  const [requests, setRequests] = useState<number[]>(DEMO_REQUESTS);
  const [limit, setLimit] = useState(3);
  const [windowSeconds, setWindowSeconds] = useState(10);
  const [now, setNow] = useState(26);
  const [playing, setPlaying] = useState(false);

  const decisions = useMemo(
    () => simulate(requests, windowSeconds, limit),
    [requests, windowSeconds, limit],
  );
  const state = windowAt(decisions, now, windowSeconds, limit);
  const denied = decisions.filter((d) => !d.allowed).length;

  // Play: the clock runs, and the window slides along the timeline (looping at the end).
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      setNow((t) => (t + PLAY_STEP_SECONDS > TIMELINE_SECONDS ? 0 : t + PLAY_STEP_SECONDS));
    }, PLAY_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing]);

  const addRequest = (at: number) => {
    setRequests((current) => [...current, Math.round(at * 10) / 10]);
  };
  const onTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - rect.left) / rect.width) * TIMELINE_SECONDS;
    addRequest(Math.min(TIMELINE_SECONDS, Math.max(0, at)));
  };
  const windowStart = Math.max(0, now - windowSeconds);

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 sm:p-6">
      <div className="grid gap-5 md:grid-cols-3">
        <Slider
          label="limit"
          hint="requests per window"
          value={limit}
          min={1}
          max={6}
          step={1}
          display={String(limit)}
          onChange={setLimit}
        />
        <Slider
          label="window"
          hint="seconds"
          value={windowSeconds}
          min={3}
          max={30}
          step={1}
          display={`${String(windowSeconds)} s`}
          onChange={setWindowSeconds}
        />
        <Slider
          label="now"
          hint="the clock"
          value={now}
          min={0}
          max={TIMELINE_SECONDS}
          step={0.1}
          display={`${oneDecimal(now)} s`}
          onChange={(value) => {
            setPlaying(false);
            setNow(value);
          }}
        />
      </div>

      {/* The timeline. Clicking it sends a request at that moment. */}
      <div className="mt-8 select-none">
        <div
          className="relative h-28 cursor-crosshair rounded-lg border border-white/10 bg-black/30"
          onClick={onTrackClick}
          role="presentation"
        >
          <div
            aria-hidden
            className="absolute inset-y-0 border-x border-emerald-400/50 bg-emerald-400/10 transition-[left,width] duration-75"
            style={{ left: percent(windowStart), width: percent(now - windowStart) }}
          />
          <div
            aria-hidden
            className="absolute inset-y-0 w-px bg-cyan-400 transition-[left] duration-75"
            style={{ left: percent(now) }}
          />
          {decisions.map((decision, index) => (
            <button
              key={`${String(decision.at)}-${String(index)}`}
              type="button"
              title={
                decision.allowed
                  ? `t=${oneDecimal(decision.at)}s · allowed (click to remove)`
                  : `t=${oneDecimal(decision.at)}s · denied, retry in ${oneDecimal(decision.retryAfter)}s (click to remove)`
              }
              aria-label={`Request at ${oneDecimal(decision.at)} seconds, ${decision.allowed ? 'allowed' : 'denied'}. Remove.`}
              onClick={(event) => {
                event.stopPropagation(); // remove, don't add another one here
                setRequests((current) => {
                  const position = current.indexOf(decision.at);
                  return current.filter((_, i) => i !== position);
                });
              }}
              className="group absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{ left: percent(decision.at) }}
            >
              <span
                className={`block size-3 rounded-full ring-2 ring-canvas transition-transform group-hover:scale-150 ${
                  decision.allowed ? 'bg-emerald-400' : 'bg-rose-500'
                } ${decision.at > now ? 'opacity-35' : ''}`}
              />
            </button>
          ))}
        </div>
        <div aria-hidden className="relative mt-2 h-4 font-mono text-[10px] text-zinc-600">
          {[0, 10, 20, 30, 40, 50, 60].map((second) => (
            <span
              key={second}
              className="absolute -translate-x-1/2"
              style={{ left: percent(second) }}
            >
              {second}s
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-xs text-zinc-400 sm:text-sm" aria-live="off">
          <span className="text-zinc-600">ZCARD</span>{' '}
          <span className={state.remaining === 0 ? 'text-rose-400' : 'text-emerald-300'}>
            {state.used}/{limit}
          </span>
          <span className="text-zinc-600"> · </span>
          {state.remaining > 0
            ? `${String(state.remaining)} left in this window`
            : `full: next slot in ${oneDecimal(state.freesIn)} s`}
          <span className="text-zinc-600"> · </span>
          <span className="text-rose-400">{denied}</span> denied overall
        </p>

        <div className="flex flex-wrap gap-2 font-mono text-xs">
          <LabButton
            onClick={() => {
              setPlaying((p) => !p);
            }}
            primary
          >
            {playing ? '❚❚ pause' : '▶ play'}
          </LabButton>
          <LabButton
            onClick={() => {
              addRequest(now);
            }}
          >
            + request now
          </LabButton>
          <LabButton
            onClick={() => {
              setRequests(DEMO_REQUESTS);
            }}
          >
            reset
          </LabButton>
          <LabButton
            onClick={() => {
              setRequests([]);
            }}
          >
            clear
          </LabButton>
        </div>
      </div>

      <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-zinc-500">
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-400" />
          allowed
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-rose-500" />
          denied (not counted)
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2 w-3 bg-emerald-400/20" />
          window (now − {windowSeconds}s, now]
        </span>
        <span>tap the track to add a request, tap a dot to remove it</span>
      </p>
    </div>
  );
}

interface SliderProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function Slider({ label, hint, value, min, max, step, display, onChange }: SliderProps) {
  const id = `lab-${label}`;
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-xs">
        <label htmlFor={id} className="text-zinc-300">
          --{label} <span className="text-zinc-600">{hint}</span>
        </label>
        <output htmlFor={id} className="text-emerald-300">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
        className="mt-2 w-full"
      />
    </div>
  );
}

function LabButton({
  children,
  onClick,
  primary = false,
}: {
  children: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 transition ${
        primary
          ? 'border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10'
          : 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}
