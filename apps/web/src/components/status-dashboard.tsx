'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  fetchDashboard,
  formatMs,
  formatRatio,
  formatUptime,
  overallHealth,
  secondsAgo,
  type DashboardData,
  type Health,
} from '@/lib/status';
import { countOf } from '@/lib/format';
import { CHART_STEP_SECONDS, CHART_WINDOW_MS, type SystemMetrics } from '@/lib/system-metrics';
import { CacheCard } from './admin/cache-card';
import { QueueCard } from './admin/queue-card';
import { LiveChart } from './live-chart';

/** Prometheus reads every process every 15 s; polling faster would repeat the same numbers. */
const POLL_MS = CHART_STEP_SECONDS * 1000;

/** So "postgres: down" says what stops working. */
const DEPENDENCY_ROLES: Partial<Record<string, string>> = {
  postgres: 'The database: content, visits and contact messages, kept for good.',
  redis: 'In-memory store: the content cache, the queues below and the contact-form limit.',
};
/** The owner-only route that asks the API and Prometheus (app/admin/system-status). */
const STATUS_URL = '/admin/system-status';

/**
 * The live system dashboard on /admin (DESIGN.md §8.6, §15.5). Polls every 15 s while the tab is
 * visible: the API's status, and Prometheus's numbers for both replicas, charts included, so
 * they are full from the start. Keeps the last poll, marked stale, if this site stops answering.
 */
export function StatusDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    let controller: AbortController | null = null;

    const schedule = () => {
      if (!stopped) timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    async function poll() {
      if (document.visibilityState === 'hidden') {
        schedule(); // nobody is looking: skip
        return;
      }
      controller = new AbortController();
      try {
        const next = await fetchDashboard({
          url: STATUS_URL,
          fetch: window.fetch.bind(window),
          signal: controller.signal,
        });
        setData(next);
        setUpdatedAt(Date.now());
        setFailed(false);
      } catch {
        if (!stopped) setFailed(true); // keep the last numbers, marked stale
      }
      schedule();
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        void poll(); // back on the tab: refresh at once
      }
    };

    void poll();
    document.addEventListener('visibilitychange', onVisibility);
    const clock = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearTimeout(timer);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (data === null) {
    return (
      <p className="font-mono text-sm text-muted" role="status">
        {failed ? (
          <span className="text-rose-700">✕ No answer from this site. Retrying every 15 s…</span>
        ) : (
          'connecting…'
        )}
      </p>
    );
  }

  const { status, metrics } = data;
  const uptime = metrics?.uptimeSeconds ?? null;
  const pageViews = status?.analytics.pageViewsLast24h ?? null;
  const health = overallHealth(data);
  const age = updatedAt === null ? 0 : secondsAgo(updatedAt, now);

  return (
    <div className="space-y-6">
      <Banner failed={failed} health={health} age={age} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          label="uptime"
          value={uptime === null ? '—' : formatUptime(uptime)}
          description="Time since the API last started (its most recently started replica). A deploy restarts it; the numbers below carry on."
        />
        <Tile
          label="requests · 5 min"
          value={metrics === null ? '—' : String(Math.round(metrics.requests))}
          description="Requests the API answered in the last 5 minutes, both replicas together: content for page loads, analytics from browsers, contact messages. Health checks, Prometheus and this dashboard are left out. Prometheus estimates it from its readings every 15 s, so it can be a little off."
        />
        <Tile
          label="latency p50"
          value={formatMs(metrics?.p50Ms ?? null)}
          description="Typical response time: at least half of those requests were answered faster than this."
        />
        <Tile
          label="latency p95"
          value={formatMs(metrics?.p95Ms ?? null)}
          description="The slow end: at least 95 in 100 requests were faster than this. It is what the unluckiest visitors feel."
        />
        <Tile
          label="cache hit ratio · 24 h"
          value={formatRatio(metrics?.hitRatio ?? null)}
          {...(metrics === null
            ? {}
            : {
                note: `${countOf(Math.round(metrics.cacheHits), 'hit')} · ${countOf(Math.round(metrics.cacheMisses), 'miss', 'misses')}`,
              })}
          description="Share of content reads in the last 24 hours answered from Redis without asking the database. Explained below."
        />
        <Tile
          label="page views · 24 h"
          value={pageViews === null ? '—' : String(pageViews)}
          description="Page views saved to the database in the last 24 hours, crawlers included, so it can differ from the Visitors combined. If people visit but this stands still, saving is stuck."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <LiveChartSection charts={metrics?.charts ?? null} now={now} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="dependencies">
          <p className="-mt-2 mb-4 text-xs leading-relaxed text-muted">
            The two datastores the API needs: whether each answers, and how long one round trip
            took.
          </p>
          {status === null && (
            <p className="font-mono text-sm text-muted">unknown: the API is not answering</p>
          )}
          <ul className="space-y-3">
            {Object.entries(status?.dependencies ?? {}).map(([name, dependency]) => (
              <li key={name}>
                <div className="flex items-center justify-between font-mono text-sm">
                  <span className="text-body">{name}</span>
                  {dependency.status === 'up' ? (
                    <span className="text-body">
                      <span className="text-emerald-700">● up</span> · {dependency.latencyMs} ms
                    </span>
                  ) : (
                    <span className="text-rose-700">✕ down</span>
                  )}
                </div>
                {DEPENDENCY_ROLES[name] !== undefined && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {DEPENDENCY_ROLES[name]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <CacheCard
          cache={{
            hits: Math.round(metrics?.cacheHits ?? 0),
            misses: Math.round(metrics?.cacheMisses ?? 0),
            hitRatio: metrics?.hitRatio ?? null,
          }}
        />
      </div>

      <QueueCard queues={status?.queues ?? null} />

      <p className="font-mono text-xs leading-relaxed text-faint">
        Prometheus reads each process every 15 s:{' '}
        {metrics === null
          ? 'unknown'
          : metrics.targets.map((target, index) => (
              <span key={target.name}>
                {index > 0 && ', '}
                <span className={target.up ? 'text-muted' : 'text-rose-700'}>
                  {target.name} {target.up ? '●' : '✕'}
                </span>
              </span>
            ))}{' '}
        · requests and latency cover the last 5 minutes of both replicas, the cache 24 hours, the
        charts 30 minutes · dependencies, queues and page views come from the API · refreshed every
        15 s while this tab is open
      </p>
    </div>
  );
}

function LiveChartSection(props: { charts: SystemMetrics['charts'] | null; now: number }) {
  // A missing point or two (Prometheus restarting) still draws one line.
  const axis = { end: props.now, windowMs: CHART_WINDOW_MS, maxGapMs: 3 * POLL_MS };
  return (
    <>
      <LiveChart
        title="Latency p95 (ms), both replicas"
        points={props.charts?.p95Ms ?? []}
        format={formatMs}
        {...axis}
      />
      <LiveChart
        title="Requests in the last 5 min, both replicas"
        points={props.charts?.requests ?? []}
        format={(value) => (value === null ? '—' : String(Math.round(value)))}
        {...axis}
      />
    </>
  );
}

function Banner(props: { failed: boolean; health: Health; age: number }) {
  let tone = 'border-emerald-600/30 text-emerald-700';
  let text = '✓ All systems operational';
  if (props.failed) {
    tone = 'border-rose-500/40 text-rose-700';
    text = `✕ No answer from this site. Showing numbers from ${String(props.age)} s ago`;
  } else if (props.health.level === 'down') {
    tone = 'border-rose-500/40 text-rose-700';
    text = `✕ ${props.health.problems.join(' · ')}`;
  } else if (props.health.level === 'degraded') {
    tone = 'border-amber-400/40 text-amber-700';
    text = `! Degraded: ${props.health.problems.join(' · ')}`;
  }
  return (
    <div
      role="status"
      className={`flex flex-col gap-1 rounded-xl border bg-surface px-4 py-3 font-mono text-sm sm:flex-row sm:items-center sm:justify-between ${tone}`}
    >
      <span>{text}</span>
      <span className="flex items-center gap-2 text-xs text-muted">
        <span
          aria-hidden
          className={`size-2 rounded-full ${props.failed ? 'bg-rose-500' : 'animate-pulse bg-emerald-500'}`}
        />
        updated {props.age} s ago
      </span>
    </div>
  );
}

function Tile(props: { label: string; value: string; note?: string; description: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[11px] text-muted">{props.label}</p>
      <p className="mt-2 font-mono text-xl text-ink sm:text-2xl">{props.value}</p>
      {props.note !== undefined && (
        <p className="mt-1 font-mono text-[10px] text-faint">{props.note}</p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted">{props.description}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="mb-4 font-mono text-xs text-muted">{title}</h2>
      {children}
    </section>
  );
}
