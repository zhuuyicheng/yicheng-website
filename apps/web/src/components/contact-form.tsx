'use client';

import { CONTACT_LIMITS } from '@portfolio/shared';
import { Send } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { PUBLIC_API_BASE_URL } from '@/lib/config';
import {
  messageCounter,
  rateLimitedMessage,
  sendContact,
  sentMessage,
  validateContact,
  type ContactField,
  type ContactOutcome,
  type FieldErrors,
} from '@/lib/contact';

type Status = { kind: 'idle' } | { kind: 'sending' } | ContactOutcome;

const EMPTY = { name: '', email: '', message: '' };

const LABELS: Record<ContactField, string> = { name: 'Name', email: 'Email', message: 'Message' };

/**
 * The contact form (DESIGN.md §7.6): validates with the API's schema, then sends. Every answer
 * gets a message: sent, a field problem, rate limited (with the wait), or unavailable.
 */
export function ContactForm() {
  const [values, setValues] = useState<Record<ContactField, string>>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const messageCount = messageCounter(values.message.length);

  const update = (field: ContactField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field] !== undefined) {
      // Typing clears the field's error (deleted, not undefined: exactOptionalPropertyTypes).
      setErrors((current) => {
        const { [field]: _cleared, ...rest } = current;
        return rest;
      });
    }
  };

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateContact(values);
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      return;
    }
    setStatus({ kind: 'sending' });
    const outcome = await sendContact(validation.request, {
      baseUrl: PUBLIC_API_BASE_URL,
      fetch: window.fetch.bind(window),
    });
    setStatus(outcome);
    if (outcome.kind === 'invalid') {
      setErrors(outcome.fieldErrors);
    }
    if (outcome.kind === 'sent') {
      setValues(EMPTY);
      setErrors({});
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-sm">
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="name" error={errors.name}>
            <input
              id="contact-name"
              name="name"
              autoComplete="name"
              maxLength={CONTACT_LIMITS.name}
              value={values.name}
              onChange={(event) => {
                update('name', event.target.value);
              }}
              aria-invalid={errors.name !== undefined}
              aria-describedby={errors.name !== undefined ? 'contact-name-error' : undefined}
              className={inputClass(errors.name)}
            />
          </Field>
          <Field label="email" error={errors.email}>
            <input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={CONTACT_LIMITS.email}
              value={values.email}
              onChange={(event) => {
                update('email', event.target.value);
              }}
              aria-invalid={errors.email !== undefined}
              aria-describedby={errors.email !== undefined ? 'contact-email-error' : undefined}
              className={inputClass(errors.email)}
            />
          </Field>
        </div>

        <Field
          label="message"
          error={errors.message}
          aside={messageCount.text}
          asideWarn={messageCount.atLimit}
          status={messageCount.atLimit ? 'Character limit reached.' : ''}
        >
          <textarea
            id="contact-message"
            name="message"
            rows={6}
            maxLength={CONTACT_LIMITS.message}
            value={values.message}
            onChange={(event) => {
              update('message', event.target.value);
            }}
            aria-invalid={errors.message !== undefined}
            aria-describedby={errors.message !== undefined ? 'contact-message-error' : undefined}
            className={`${inputClass(errors.message)} resize-y`}
          />
        </Field>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            Your message comes straight to me. See the{' '}
            <Link href="/privacy" prefetch className="underline underline-offset-2 hover:text-body">
              privacy notice
            </Link>
            .
          </p>
          <button
            type="submit"
            disabled={status.kind === 'sending'}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-brand-strong disabled:cursor-wait disabled:opacity-60"
          >
            <Send aria-hidden className="size-4" />
            {status.kind === 'sending' ? 'Sending…' : 'Send message'}
          </button>
        </div>

        <StatusLine status={status} />
      </form>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  let line: { ok: boolean; text: string } | null = null;
  switch (status.kind) {
    case 'sent':
      line = { ok: true, text: sentMessage(status.remaining, status.policy) };
      break;
    case 'rate_limited':
      line = { ok: false, text: rateLimitedMessage(status.retryAfterSeconds, status.policy) };
      break;
    case 'invalid':
      line = { ok: false, text: 'Please fix the highlighted fields.' };
      break;
    case 'failed':
      line = { ok: false, text: status.message };
      break;
    case 'idle':
    case 'sending':
      break;
  }

  return (
    <p role="status" aria-live="polite" className="min-h-5 text-sm">
      {line && (
        <span className={line.ok ? 'text-brand' : 'text-rose-700'}>
          {line.ok ? '✓ ' : '✗ '}
          {line.text}
        </span>
      )}
    </p>
  );
}

function Field({
  label,
  error,
  aside,
  asideWarn = false,
  status,
  children,
}: {
  label: ContactField;
  error: string | undefined;
  aside?: string;
  /** The aside in amber, e.g. a counter at its limit. */
  asideWarn?: boolean;
  /**
   * A note under the box, read out by screen readers when it changes (an empty string keeps the
   * live region in place, so the first note is announced too).
   */
  status?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <label htmlFor={`contact-${label}`} className="text-body">
          {LABELS[label]}
        </label>
        {aside !== undefined && (
          <span className={`text-xs tabular-nums ${asideWarn ? 'text-amber-700' : 'text-faint'}`}>
            {aside}
          </span>
        )}
      </div>
      {children}
      {status !== undefined && (
        <p role="status" className="text-xs text-amber-700 empty:hidden">
          {status}
        </p>
      )}
      {error !== undefined && (
        <p id={`contact-${label}-error`} className="mt-1.5 text-xs text-rose-700">
          {LABELS[label]} {error}
        </p>
      )}
    </div>
  );
}

function inputClass(error: string | undefined): string {
  return `w-full rounded-md border bg-surface px-3 py-2.5 text-sm text-ink placeholder-faint outline-none transition focus:ring-2 ${
    error === undefined
      ? 'border-field focus:border-brand/60 focus:ring-brand/20'
      : 'border-rose-500/60 focus:ring-rose-500/20'
  }`;
}
