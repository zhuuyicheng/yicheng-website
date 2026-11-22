import type { SystemStatus } from '@portfolio/shared';
import { formatRatio } from '@/lib/status';

/**
 * What the cache hit ratio measures and how to read it (DESIGN.md §8.1): the content
 * cache-aside in Redis, counted by each API replica since it started, added up by the dashboard.
 */
export function CacheCard({ cache }: { cache: SystemStatus['cache'] }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm text-body">The content cache</h3>
        <p className="font-mono text-sm text-ink tabular-nums">
          {formatRatio(cache.hitRatio)}
          <span className="ml-2 text-xs text-muted">
            {cache.hits} hits · {cache.misses} misses
          </span>
        </p>
      </div>
      <div className="mt-3 space-y-3 text-xs leading-relaxed text-body">
        <p>
          Your profile and projects are stored in Postgres, the database. Every page a visitor opens
          makes the web server ask the API for that content (one or two reads per page). The API
          looks for a copy in Redis first, which keeps data in memory and answers faster:
        </p>
        <ul className="space-y-1 pl-4">
          <li className="list-disc">
            <strong className="font-medium text-ink">Hit:</strong> a copy was there and was used.
          </li>
          <li className="list-disc">
            <strong className="font-medium text-ink">Miss:</strong> no copy (the first read, or the
            copy had expired after about 5 minutes), so the API read Postgres and saved a fresh copy
            for the next reads.
          </li>
        </ul>
        <p>
          The ratio is hits ÷ (hits + misses) since the API last started. With few visitors a copy
          often expires before the next one arrives, so a low ratio is normal and costs only a few
          milliseconds per miss. It matters under heavy traffic, when a high ratio keeps almost
          every read off the database. Publishing new content (npm run content:seed) clears the
          copies, so changes show at once.
        </p>
      </div>
    </section>
  );
}
