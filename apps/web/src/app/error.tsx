'use client';

/**
 * Shown when rendering a page fails, typically because the API is unreachable (lib/api.ts
 * throws). The header and footer stay; `retry` renders the page again.
 */
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-32 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
        This page couldn&apos;t load
      </h1>
      <p className="mt-4 text-muted">
        The site&apos;s server is unavailable right now. It is usually back within a minute.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-8 min-h-11 rounded-full border border-brand/60 px-5 py-2.5 text-sm font-medium text-brand hover:bg-brand-soft"
      >
        Try again
      </button>
    </div>
  );
}
