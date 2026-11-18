'use client';

/**
 * Shown when rendering a page fails, typically because the API is unreachable (lib/api.ts
 * throws). The header and footer stay; `retry` renders the page again.
 */
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-32 font-mono text-sm sm:px-6">
      <p className="text-zinc-500">
        <span className="text-zinc-600">$</span> curl api/v1/profile
      </p>
      <p className="mt-2 text-rose-400">error: the backend did not answer</p>
      <p className="mt-4 text-zinc-400">
        The site&apos;s API is unavailable right now. It is usually back within a minute.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-8 rounded-md border border-emerald-400/60 px-4 py-2 text-emerald-300 hover:bg-emerald-400/10"
      >
        ↻ retry
      </button>
    </div>
  );
}
