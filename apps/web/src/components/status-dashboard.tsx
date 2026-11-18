'use client';

import type { SystemStatus } from '@portfolio/shared';
import { useEffect, useState, type ReactNode } from 'react';
import {
  appendSample,
  CHART_WINDOW_MS,
  fetchStatus,
  formatMs,
  formatRatio,
  formatUptime,
  overallHealth,
  secondsAgo,
  type Sample,
} from '@/lib/status';
import { LiveChart } from './live-chart';

/** The API caches its status for 5 s, so polling faster would only repeat the same numbers. */
const POLL_MS = 5_000;
/** The owner-only route that asks the API for its status (app/admin/system-status). */
const STATUS_URL = '/admin/system-status';

/**
 * The owner's live system dashboard, on /admin (DESIGN.md §7.7, §8.7). Polls every 5 s,
 * pauses while the tab is hidden, and keeps showing the last good numbers (marked stale) if
 * the API stops answering. The charts cover the last 30 minutes this page was open.
 */
export function StatusDashboard() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
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
        schedule(); // nobody is looking: skip this round
        return;
      }
      controller = new AbortController();
      try {
        const next = await fetchStatus({
          url: STATUS_URL,
          fetch: window.fetch.bind(window),
          signal: controller.signal,
        });
        const at = Date.now();
        setStatus(next);
        setUpdatedAt(at);
        setFailed(false);
        setHistory((h) =>
          appendSample(
            h,
            { at, p95: next.http.latencyMs.p95, requests: next.http.requestCount },
            CHART_WINDOW_MS,
          ),
        );
      } catch {
        if (!stopped) setFailed(true); // keep the last numbers on screen, marked stale
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

  if (status === null) {
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

  const health = overallHealth(status);
  const age = updatedAt === null ? 0 : secondsAgo(updatedAt, now);
  const queues = status.queues;

  return (
    <div className="space-y-6">
      <Banner failed={failed} level={health.level} down={health.down} age={age} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="uptime" value={formatUptime(status.uptimeSeconds)} />
        <Tile label="requests · 5 min" value={String(status.http.requestCount)} />
        <Tile label="latency p50" value={formatMs(status.http.latencyMs.p50)} />
        <Tile label="latency p95" value={formatMs(status.http.latencyMs.p95)} />
        <Tile
          label="cache hit ratio"
          value={formatRatio(status.cache.hitRatio)}
          note={`${String(status.cache.hits)} hits · ${String(status.cache.misses)} misses`}
        />
        <Tile
          label="page views · 24 h"
          value={
            status.analytics.pageViewsLast24h === null
              ? '—'
              : String(status.analytics.pageViewsLast24h)
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <LiveChartSection history={history} now={now} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="dependencies">
          <ul className="space-y-3">
            {Object.entries(status.dependencies).map(([name, dependency]) => (
              <li key={name} className="flex items-center justify-between font-mono text-sm">
                <span className="text-body">{name}</span>
                {dependency.status === 'up' ? (
                  <span className="text-body">
                    <span className="text-emerald-700">● up</span> · {dependency.latencyMs} ms
                  </span>
                ) : (
                  <span className="text-rose-700">✕ down</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="queues (redis)">
          {queues === null ? (
            <p className="font-mono text-sm text-muted">unknown: Redis did not answer</p>
          ) : (
            <ul className="space-y-3 font-mono text-sm">
              <Queue name="telemetry buffer" count={queues.telemetryBuffer} />
              <Queue name="telemetry dead letters" count={queues.telemetryDeadLetter} deadLetter />
              <Queue name="notifications ready" count={queues.notificationsReady} />
              <Queue name="notifications delayed" count={queues.notificationsDelayed} />
              <Queue
                name="notification dead letters"
                count={queues.notificationsDeadLetter}
                deadLetter
              />
            </ul>
          )}
        </Card>
      </div>

      <p className="font-mono text-xs leading-relaxed text-faint">
        answered by <span className="text-muted">{status.instance}</span> · polled every 5 s while
        this tab is open · numbers are per API process since it started, latency over the last 5
        minutes
      </p>
    </div>
  );
}

function LiveChartSection({ history, now }: { history: Sample[]; now: number }) {
  const axis = { end: now, windowMs: CHART_WINDOW_MS, maxGapMs: 3 * POLL_MS };
  return (
    <>
      <LiveChart
        title="Latency p95 (ms)"
        points={history.map((sample) => ({ at: sample.at, value: sample.p95 }))}
        format={formatMs}
        {...axis}
      />
      <LiveChart
        title="Requests in the last 5 min"
        points={history.map((sample) => ({ at: sample.at, value: sample.requests }))}
        format={(value) => (value === null ? '—' : String(Math.round(value)))}
        {...axis}
      />
    </>
  );
}

function Banner(props: {
  failed: boolean;
  level: 'operational' | 'degraded';
  down: string[];
  age: number;
}) {
  let tone = 'border-emerald-600/30 text-emerald-700';
  let text = '✓ All systems operational';
  if (props.failed) {
    tone = 'border-rose-500/40 text-rose-700';
    text = `✕ Lost contact with the API. Showing numbers from ${String(props.age)} s ago`;
  } else if (props.level === 'degraded') {
    tone = 'border-amber-400/40 text-amber-700';
    text = `! Degraded: ${props.down.join(', ')} ${props.down.length === 1 ? 'is' : 'are'} down`;
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

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[11px] text-muted">{label}</p>
      <p className="mt-2 font-mono text-xl text-ink sm:text-2xl">{value}</p>
      {note !== undefined && <p className="mt-1 font-mono text-[10px] text-faint">{note}</p>}
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

function Queue({
  name,
  count,
  deadLetter = false,
}: {
  name: string;
  count: number;
  deadLetter?: boolean;
}) {
  const attention = deadLetter && count > 0;
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted">{name}</span>
      <span className="text-ink">
        {attention && <span className="mr-2 text-amber-700">! needs attention</span>}
        {count}
      </span>
    </li>
  );
}
