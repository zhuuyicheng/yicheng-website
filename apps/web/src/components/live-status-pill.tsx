'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PUBLIC_API_BASE_URL } from '@/lib/config';
import { fetchStatus, formatMs, overallHealth } from '@/lib/status';

const REFRESH_MS = 30_000;

type PillState =
  | { kind: 'loading' }
  | { kind: 'live'; operational: boolean; p95: number | null }
  | { kind: 'offline' };

/**
 * A small "this site is alive" badge in the hero: the API's health and current p95 latency,
 * linking to the full dashboard. Asks once on load, then every 30 s.
 */
export function LiveStatusPill() {
  const [state, setState] = useState<PillState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const status = await fetchStatus({
          baseUrl: PUBLIC_API_BASE_URL,
          fetch: window.fetch.bind(window),
          signal: controller.signal,
        });
        setState({
          kind: 'live',
          operational: overallHealth(status).level === 'operational',
          p95: status.http.latencyMs.p95,
        });
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'offline' });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const dot =
    state.kind === 'live' && state.operational
      ? 'animate-pulse bg-emerald-400'
      : state.kind === 'loading'
        ? 'bg-zinc-600'
        : 'bg-amber-400';
  const text =
    state.kind === 'live'
      ? `${state.operational ? 'live' : 'degraded'} · api p95 ${formatMs(state.p95)}`
      : state.kind === 'offline'
        ? 'api offline'
        : 'connecting…';

  return (
    <Link
      href="/status"
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/60 px-3 py-1 font-mono text-xs text-zinc-400 transition hover:border-emerald-400/40 hover:text-zinc-200"
    >
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {text}
      <span className="text-zinc-600">→ status</span>
    </Link>
  );
}
