'use client';

import type { DeadLetter, QueueItem, QueueItems, QueueName } from '@portfolio/shared';
import { useEffect, useState } from 'react';
import {
  clipText,
  DEAD_LETTER_HELP,
  deadLetterReasons,
  eventLabel,
  eventSource,
  fetchQueueItems,
  formatWhen,
  shownLabel,
} from '@/lib/queue-items';

type Loaded = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; result: QueueItems };

/** How much of a contact message shows before "Show all". */
const MESSAGE_PREVIEW_CHARS = 280;

/**
 * "Show items" under a queue (DESIGN.md §8.7): read on request, not with the 5 s poll, and kept
 * until reloaded. Takes nothing out.
 */
export function QueueItemsPanel({ queue, count }: { queue: QueueName; count: number }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0); // "Reload" bumps it to read again
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    fetchQueueItems({ queue, fetch: window.fetch.bind(window), signal: controller.signal })
      .then((result) => {
        setLoaded({ state: 'ready', result });
      })
      .catch(() => {
        // Unless closed or reloaded meanwhile, say so and offer a retry.
        if (!controller.signal.aborted) setLoaded({ state: 'failed' });
      });
    return () => {
      controller.abort();
    };
  }, [open, round, queue]);

  const reload = () => {
    setLoaded({ state: 'loading' });
    setRound((n) => n + 1);
  };

  // Nothing to show, but an open panel stays open so loaded items don't vanish.
  if (!open && count === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open) setLoaded({ state: 'loading' });
          setOpen(!open);
        }}
        className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-line-strong hover:text-ink"
      >
        {open ? 'Hide items' : 'Show items'}
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-line px-3 py-3 sm:px-4">
          {loaded.state === 'loading' && (
            <p role="status" className="text-xs text-muted">
              Reading the queue…
            </p>
          )}
          {loaded.state === 'failed' && (
            <p role="status" className="text-xs text-rose-700">
              Could not read the queue: the API did not answer.{' '}
              <button type="button" onClick={reload} className="underline underline-offset-2">
                Try again
              </button>
            </p>
          )}
          {loaded.state === 'ready' && <ItemList result={loaded.result} onReload={reload} />}
        </div>
      )}
    </div>
  );
}

function ItemList({ result, onReload }: { result: QueueItems; onReload: () => void }) {
  const reasons = deadLetterReasons(result.items);
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {shownLabel(result)} · read at {formatWhen(result.generatedAt)}
        </span>
        <button type="button" onClick={onReload} className="text-brand hover:underline">
          Reload
        </button>
      </div>

      {reasons.length > 0 && (
        <div className="mt-3 rounded-md bg-sunken px-3 py-2">
          <p className="text-xs font-medium text-ink">Before retrying</p>
          <ul className="mt-1 space-y-1 text-xs leading-relaxed text-body">
            {reasons.map((reason) => (
              <li key={reason}>
                <span className="text-ink">{DEAD_LETTER_HELP[reason].label}:</span>{' '}
                {DEAD_LETTER_HELP[reason].fix}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.items.length > 0 && (
        <ol className="mt-2 divide-y divide-line">
          {result.items.map((item, index) => (
            // By position: the same entry can be queued twice.
            <li key={index} className="py-2.5 text-xs leading-relaxed">
              {item.kind === 'event' ? <EventItem item={item} /> : <NotificationItem item={item} />}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function EventItem({ item }: { item: Extract<QueueItem, { kind: 'event' }> }) {
  const { event, deadLetter, raw } = item;
  return (
    <>
      {event === null ? (
        <p className="text-ink">An entry that cannot be read</p>
      ) : (
        <>
          <p className="text-ink">
            <span className="text-muted tabular-nums">{formatWhen(event.receivedAt)}</span> ·{' '}
            <span className="break-words">{eventLabel(event)}</span>
          </p>
          <p className="text-muted">{eventSource(event)}</p>
        </>
      )}
      {deadLetter !== null && <WhyItFailed deadLetter={deadLetter} />}
      {raw !== null && <RawText text={raw} />}
    </>
  );
}

function NotificationItem({ item }: { item: Extract<QueueItem, { kind: 'notification' }> }) {
  const { attempt, dueAt, message, deadLetter, raw } = item;
  const tries = [
    attempt !== null && attempt > 1 ? `try ${String(attempt)}` : null,
    dueAt === null ? null : `next try ${formatWhen(dueAt)}`,
  ].filter((part): part is string => part !== null);
  return (
    <>
      {message !== null && (
        <>
          <p className="break-words text-ink">
            {message.name} <span className="text-muted">&lt;{message.email}&gt;</span>
          </p>
          <p className="text-muted tabular-nums">
            sent {formatWhen(message.createdAt)}
            {tries.length > 0 && ` · ${tries.join(' · ')}`}
          </p>
          <MessageText text={message.message} />
          {deadLetter === null && message.lastError !== null && (
            <p className="mt-1 text-muted">
              Last try failed: <span className="break-words">{message.lastError}</span>
            </p>
          )}
        </>
      )}
      {message === null && raw === null && (
        <p className="text-muted">
          Its message is no longer in the database, so there is nothing to tell you about.
        </p>
      )}
      {message === null && raw !== null && <p className="text-ink">A job that cannot be read</p>}
      {deadLetter !== null && <WhyItFailed deadLetter={deadLetter} />}
      {raw !== null && <RawText text={raw} />}
    </>
  );
}

/** The reason in words, when, and the error as reported. */
function WhyItFailed({ deadLetter }: { deadLetter: DeadLetter }) {
  return (
    <div className="mt-1">
      <p className="text-amber-700">
        {DEAD_LETTER_HELP[deadLetter.reason].label} · {formatWhen(deadLetter.failedAt)}
        {deadLetter.errorCode !== null && ` · error code ${deadLetter.errorCode}`}
      </p>
      <p className="font-mono text-[11px] break-words text-body">{deadLetter.error}</p>
    </div>
  );
}

function RawText({ text }: { text: string }) {
  return (
    <pre className="mt-1 rounded bg-sunken px-2 py-1 font-mono text-[11px] break-all whitespace-pre-wrap text-body">
      {text}
    </pre>
  );
}

function MessageText({ text }: { text: string }) {
  const [whole, setWhole] = useState(false);
  const preview = clipText(text, MESSAGE_PREVIEW_CHARS);
  return (
    <p className="mt-1 break-words whitespace-pre-wrap text-body">
      {whole ? text : preview.text}
      {preview.clipped && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => {
              setWhole(!whole);
            }}
            className="text-brand hover:underline"
          >
            {whole ? 'Show less' : 'Show all'}
          </button>
        </>
      )}
    </p>
  );
}
