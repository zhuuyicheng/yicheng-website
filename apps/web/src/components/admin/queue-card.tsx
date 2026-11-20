import type { SystemStatus } from '@portfolio/shared';

type QueueDepths = NonNullable<SystemStatus['queues']>;

interface QueueInfo {
  name: string;
  /** The Redis key, to find the same list in the Redis extension or `redis-cli`. */
  key: string;
  description: string;
  /** Dead letters failed for good: anything above 0 needs the owner (DESIGN.md §8.2, §8.3). */
  deadLetter: boolean;
  /** For dead letters: the command that retries them once the cause is fixed. */
  replay?: string;
}

/**
 * What each queue holds, in the order the work flows. A `Record` over the contract's fields,
 * so a queue added to the status report without an explanation here fails the typecheck.
 */
const QUEUES: Record<keyof QueueDepths, QueueInfo> = {
  telemetryBuffer: {
    name: 'Analytics waiting to be saved',
    key: 'telemetry:events:buffer',
    description:
      'Page views and clicks the API has accepted but the worker has not yet written to the database. It saves them in batches every few seconds.',
    deadLetter: false,
  },
  telemetryDeadLetter: {
    name: 'Analytics that could not be saved',
    key: 'telemetry:events:dlq',
    description:
      'Events the database refused, or that were unreadable. They are kept rather than lost; fix the cause, then retry them with:',
    deadLetter: true,
    replay: 'npm run dlq:replay -- telemetry',
  },
  notificationsReady: {
    name: 'Contact notifications to send',
    key: 'jobs:notifications:ready',
    description:
      'Someone sent the contact form and the worker has not yet told you about it. The message itself is already saved in the database.',
    deadLetter: false,
  },
  notificationsDelayed: {
    name: 'Contact notifications to retry',
    key: 'jobs:notifications:delayed',
    description:
      'Sending failed for a reason that may pass (for example Discord timed out), so it waits and tries again, a little longer each time.',
    deadLetter: false,
  },
  notificationsDeadLetter: {
    name: 'Contact notifications that gave up',
    key: 'jobs:notifications:dlq',
    description:
      'Refused outright, or every retry failed. The message is safe in the database; you just were not told. Fix the cause, then retry them with:',
    deadLetter: true,
    replay: 'npm run dlq:replay -- notifications',
  },
};

/**
 * The Redis queues between the API and the worker, each with what it holds and what a normal
 * number looks like. `null` queues: Redis did not answer, so the depths are unknown.
 */
export function QueueCard({ queues }: { queues: QueueDepths | null }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h3 className="text-sm text-body">Queues (in Redis)</h3>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
        Slow work the API hands to the background worker, so it can answer visitors straight away.
        The worker picks things up within seconds, so every number here is normally 0. A waiting
        list that keeps growing means the worker or the database is down: nothing is lost, and it
        empties once they are back. A dead-letter list holds work that failed for good and will not
        fix itself, so anything there needs you.
      </p>

      {queues === null ? (
        <p className="mt-4 text-sm text-rose-700">Unknown: Redis did not answer.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {(Object.keys(QUEUES) as (keyof QueueDepths)[]).map((field) => (
            <QueueRow key={field} info={QUEUES[field]} count={queues[field]} />
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Not shown: the one batch or job the worker is handling at that moment
        (telemetry:events:inflight, jobs:notifications:processing).
      </p>
    </section>
  );
}

function QueueRow({ info, count }: { info: QueueInfo; count: number }) {
  const attention = info.deadLetter && count > 0;
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-ink">
          {info.name}
          {info.deadLetter && <span className="ml-2 text-xs text-muted">dead letters</span>}
        </p>
        <p className="font-mono text-[11px] break-all text-muted">{info.key}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{info.description}</p>
        {info.replay !== undefined && (
          <code className="mt-1 inline-block rounded bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-body">
            {info.replay}
          </code>
        )}
      </div>
      <p className="shrink-0 text-right font-mono text-lg text-ink tabular-nums">
        {count}
        {attention && <span className="block text-xs text-amber-700">needs attention</span>}
      </p>
    </li>
  );
}
