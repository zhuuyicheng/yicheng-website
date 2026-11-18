'use client';

import { CONTACT_LIMITS } from '@portfolio/shared';
import Link from 'next/link';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { PUBLIC_API_BASE_URL } from '@/lib/config';
import {
  formatWait,
  sendContact,
  validateContact,
  type ContactField,
  type ContactOutcome,
  type FieldErrors,
} from '@/lib/contact';

type Status = { kind: 'idle' } | { kind: 'sending' } | ContactOutcome;

const EMPTY = { name: '', email: '', message: '' };

/**
 * The contact form (DESIGN.md §7.6). Validates in the browser with the API's own schema, then
 * sends. Every answer the API can give has a message: sent, a field problem, rate limited (with
 * how long to wait, from the `Retry-After` header), or the server being unavailable.
 */
export function ContactForm() {
  const [values, setValues] = useState<Record<ContactField, string>>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const update = (field: ContactField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field] !== undefined) {
      // Typing in a field clears its error (removed, not set to undefined: see tsconfig's
      // exactOptionalPropertyTypes).
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
    <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/40">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span aria-hidden className="size-2.5 rounded-full bg-rose-500/70" />
        <span aria-hidden className="size-2.5 rounded-full bg-amber-400/70" />
        <span aria-hidden className="size-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-2 font-mono text-xs text-zinc-500">contact.sh</span>
      </div>

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
          aside={`${String(values.message.length)}/${String(CONTACT_LIMITS.message)}`}
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
          <p className="text-xs text-zinc-500">
            Stored and forwarded to me. See the{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-zinc-300">
              privacy notice
            </Link>
            .
          </p>
          <button
            type="submit"
            disabled={status.kind === 'sending'}
            className="rounded-md bg-emerald-400 px-5 py-2.5 font-mono text-sm font-medium text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
          >
            {status.kind === 'sending' ? 'sending…' : './send'}
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
      line = {
        ok: true,
        text:
          status.remaining === null
            ? 'Message sent. Thanks, I will get back to you.'
            : `Message sent. Thanks, I will get back to you. (${String(status.remaining)} more allowed for now)`,
      };
      break;
    case 'rate_limited':
      line = {
        ok: false,
        text: `Too many messages for now. Please try again in ${formatWait(status.retryAfterSeconds)}.`,
      };
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
    <p role="status" aria-live="polite" className="min-h-5 font-mono text-xs sm:text-sm">
      {line && (
        <span className={line.ok ? 'text-emerald-300' : 'text-rose-400'}>
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
  children,
}: {
  label: ContactField;
  error: string | undefined;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between font-mono text-xs">
        <label htmlFor={`contact-${label}`} className="text-zinc-300">
          <span className="text-emerald-400">--</span>
          {label}
        </label>
        {aside !== undefined && <span className="text-zinc-600">{aside}</span>}
      </div>
      {children}
      {error !== undefined && (
        <p id={`contact-${label}-error`} className="mt-1.5 font-mono text-xs text-rose-400">
          {label} {error}
        </p>
      )}
    </div>
  );
}

function inputClass(error: string | undefined): string {
  return `w-full rounded-md border bg-black/30 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:ring-2 ${
    error === undefined
      ? 'border-white/10 focus:border-emerald-400/60 focus:ring-emerald-400/20'
      : 'border-rose-500/60 focus:ring-rose-500/20'
  }`;
}
