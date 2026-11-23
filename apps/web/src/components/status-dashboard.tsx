'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  appendSample,
  CHART_WINDOW_MS,
  combineReplicas,
  fetchStatus,
  formatMs,
  formatRatio,
  formatUptime,
  healthProblems,
  overallHealth,
  secondsAgo,
  type CombinedStatus,
  type Health,
  type Sample,
} from '@/lib/status';
import { CacheCard } from './admin/cache-card';
import { QueueCard } from './admin/queue-card';
import { LiveChart } from './live-chart';

/** The API caches its status for 5 s; polling faster would repeat the same numbers. */
const POLL_MS = 5_000;

/** So "postgres: down" says what stops working. */
const DEPENDENCY_ROLES: Partial<Record<string, string>> = {
  postgres: 'The database: content, visits and contact messages, kept for good.',
  redis: 'In-memory store: the content cache, the queues below and the contact-form limit.',
};
/** The owner-only route that asks each API replica (app/admin/system-status). */
const STATUS_URL = '/admin/system-status';

/**
 * The live system dashboard on /admin (DESIGN.md §7.7, §8.7). Polls every 5 s while the tab is
 * visible, combining every replica's report; keeps the last numbers, marked stale, if the API
 * stops answering. Charts cover the last 30 minutes the page was open.
 */
export function StatusDashboard() {
  const [combined, setCombined] = useState<CombinedStatus | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
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
        const replicas = await fetchStatus({
          url: STATUS_URL,
          fetch: window.fetch.bind(window),
          signal: controller.signal,
        });
        const at = Date.now();
        const next = combineReplicas(replicas);
        if (next === null) {
          setFailed(true); // no replica answered: keep the last numbers, marked stale
        } else {
          setCombined(next);
          setUpdatedAt(at);
          setFailed(false);
          setHistory((h) =>
            appendSample(h, { at, p95: next.p95, requests: next.requestCount }, CHART_WINDOW_MS),
          );
        }
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

  if (combined === null) {
    return (
      <p className="font-mono text-sm text-muted" role="status">
        {failed ? (
          <span className="text-rose-700">✕ The API is not answering. Retrying every 5 s…</span>
        ) : (
          'connecting…'
        )}
      </p>
    );
  }

  const status = combined.shared;
  const health = overallHealth(status, combined.silent);
  const age = updatedAt === null ? 0 : secondsAgo(updatedAt, now);

  return (
    <div className="space-y-6">
      <Banner failed={failed} health={health} age={age} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          label="uptime"
          value={formatUptime(combined.uptimeSeconds)}
          description="Time since the API last started (its most recently started replica). A restart or deploy resets it, along with the request and cache counts."
        />
        <Tile
          label="requests · 5 min"
          value={String(combined.requestCount)}
          description="Requests the API answered in the last 5 minutes, all replicas together: content for page loads, analytics from browsers, contact messages. This dashboard's own checks are left out."
        />
        <Tile
          label="latency p50"
          value={formatMs(combined.p50)}
          description="Typical response time: at least half of those requests were answered faster than this."
        />
        <Tile
          label="latency p95"
          value={formatMs(combined.p95)}
          description="The slow end: at least 95 in 100 requests were faster than this. It is what the unluckiest visitors feel."
        />
        <Tile
          label="cache hit ratio"
          value={formatRatio(combined.hitRatio)}
          note={`${String(combined.cacheHits)} hits · ${String(combined.cacheMisses)} misses`}
          description="Share of content reads answered from Redis without asking the database. Explained below."
        />
        <Tile
          label="page views · 24 h"
          value={
            status.analytics.pageViewsLast24h === null
              ? '—'
              : String(status.analytics.pageViewsLast24h)
          }
          description="Page views saved to the database in the last 24 hours, crawlers included, so it can differ from the Visitors combined. If people visit but this stands still, saving is stuck."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <LiveChartSection history={history} now={now} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="dependencies">
          <p className="-mt-2 mb-4 text-xs leading-relaxed text-muted">
            The two datastores the API needs: whether each answers, and how long one round trip
            took.
          </p>
          <ul className="space-y-3">
            {Object.entries(status.dependencies).map(([name, dependency]) => (
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
            hits: combined.cacheHits,
            misses: combined.cacheMisses,
            hitRatio: combined.hitRatio,
          }}
        />
      </div>

      <QueueCard queues={status.queues} />

      <p className="font-mono text-xs leading-relaxed text-faint">
        {combined.answered.length === 1 ? 'one API replica' : 'API replicas'}{' '}
        <span className="text-muted">{combined.answered.join(', ')}</span>, each asked every 5 s
        while this tab is open and combined: requests and cache counts added up, latency from the
        slower one · requests and latency cover the last 5 minutes, cache counts the time since each
        replica started
      </p>
    </div>
  );
}

function LiveChartSection({ history, now }: { history: Sample[]; now: number }) {
  const axis = { end: now, windowMs: CHART_WINDOW_MS, maxGapMs: 3 * POLL_MS };
  return (
    <>
      <LiveChart
        title="Latency p95 (ms), slower replica"
        points={history.map((sample) => ({ at: sample.at, value: sample.p95 }))}
        format={formatMs}
        {...axis}
      />
      <LiveChart
        title="Requests in the last 5 min, all replicas"
        points={history.map((sample) => ({ at: sample.at, value: sample.requests }))}
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
    text = `✕ Lost contact with the API. Showing numbers from ${String(props.age)} s ago`;
  } else if (props.health.level === 'degraded') {
    tone = 'border-amber-400/40 text-amber-700';
    text = `! Degraded: ${healthProblems(props.health)}`;
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
