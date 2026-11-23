import {
  queueItemsSchema,
  type DeadLetterReasonName,
  type QueueItem,
  type QueueItems,
  type QueueName,
  type QueuedEvent,
} from '@portfolio/shared';
import { fetchOwnerData } from './owner-fetch';
import { capitalise, deviceLabel, placeLabel, referrerLabel } from './visitors';

/**
 * The queue card's "Show items" on /admin (DESIGN.md §8.7): what waits in one Redis queue, and
 * the words that explain it. No React, so it can be unit-tested.
 */

/** One queue's items, through this web server's owner route (app/admin/queues/[queue]). */
export function fetchQueueItems(options: {
  queue: QueueName;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<QueueItems> {
  const { queue, ...request } = options;
  return fetchOwnerData({ ...request, url: `/admin/queues/${queue}`, schema: queueItemsSchema });
}

/**
 * What each dead-letter reason means, and what to fix before retrying (DESIGN.md §8.2, §8.3).
 * A `Record` over the contract's reasons, so a new one without an explanation fails the
 * typecheck.
 */
export const DEAD_LETTER_HELP: Record<DeadLetterReasonName, { label: string; fix: string }> = {
  insert_failed: {
    label: 'The database refused it',
    fix: 'A bug: the API accepted a visit that the database does not allow, and the error names the rule. Fix the code and deploy, then retry.',
  },
  rejected: {
    label: 'Discord refused it',
    fix: 'Almost always a wrong or deleted webhook. Put the new webhook URL in the server’s deploy/.env and redeploy, then retry.',
  },
  attempts_exhausted: {
    label: 'Every try failed',
    fix: 'Discord was down or kept timing out. Nothing to fix once it works again: just retry.',
  },
  invalid_payload: {
    label: 'Unreadable',
    fix: 'Stored in a form the worker cannot read, so retrying cannot help: the retry leaves it where it is. Usually a bug; its text is shown below.',
  },
};

/** The different reasons among `items`, in the order they first appear: one hint each. */
export function deadLetterReasons(items: readonly QueueItem[]): DeadLetterReasonName[] {
  const reasons = items.flatMap((item) =>
    item.deadLetter === null ? [] : [item.deadLetter.reason],
  );
  return [...new Set(reasons)];
}

/** `Page view of /bowling-buddy`, `Click on linkedin (on /)`. */
export function eventLabel(event: Pick<QueuedEvent, 'type' | 'name' | 'path'>): string {
  if (event.type === 'page_view') {
    return `Page view of ${event.path}`;
  }
  const link = event.name === null ? 'a link' : event.name.replace(/^click:/, '');
  return `Click on ${link} (on ${event.path})`;
}

/** Who it was, as far as known: `Acme Pte Ltd · Singapore · Desktop · Chrome · via linkedin.com`. */
export function eventSource(event: QueuedEvent): string {
  const knownPlace = event.countryCode !== null || event.city !== null;
  const knownDevice = event.deviceType !== null || event.browser !== null || event.os !== null;
  const parts = [
    event.organization,
    knownPlace ? placeLabel(event.countryCode, event.city) : null,
    knownDevice ? deviceLabel(event) : null,
    event.referrer === null ? null : `via ${referrerLabel(event.referrer)}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Nothing known about the visitor' : parts.join(' · ');
}

const WHEN = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** `23 Nov, 11:59:03`, on the viewer's clock. */
export function formatWhen(iso: string): string {
  return WHEN.format(new Date(iso));
}

/** Which items the list shows: `All 3`, `The newest 20 of 153`, `The 20 due soonest of 31`. */
export function shownLabel(result: Pick<QueueItems, 'queue' | 'total' | 'items'>): string {
  const shown = result.items.length;
  if (result.total === 0) {
    return 'Empty now: the worker has handled everything that was here.';
  }
  if (shown >= result.total) {
    return result.total === 1 ? 'The only one' : `All ${String(result.total)}`;
  }
  const which =
    result.queue === 'notificationsDelayed'
      ? `the ${String(shown)} due soonest`
      : `the newest ${String(shown)}`;
  return `${capitalise(which)} of ${String(result.total)}`;
}

/** A long text's start (cut at `max` characters) and whether anything was left out. */
export function clipText(text: string, max: number): { text: string; clipped: boolean } {
  return text.length <= max
    ? { text, clipped: false }
    : { text: `${text.slice(0, max).trimEnd()}…`, clipped: true };
}

/** The retry command for a dead-letter list: on the server, and on your computer. */
export function replayCommands(pipeline: 'telemetry' | 'notifications'): {
  server: string;
  local: string;
} {
  return {
    server: `docker compose -f ~/portfolio/deploy/compose.prod.yml run --rm replay-dlq ${pipeline}`,
    local: `npm run dlq:replay -- ${pipeline}`,
  };
}
