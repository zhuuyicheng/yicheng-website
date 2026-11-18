import Link from 'next/link';

/** Unknown URLs and unknown project slugs. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-32 sm:px-6">
      <p className="text-sm text-zinc-500">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">Page not found</h1>
      <p className="mt-4 text-zinc-400">This page doesn&apos;t exist, or it has moved.</p>
      <Link
        href="/"
        className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-emerald-400/60 hover:text-white"
      >
        <span aria-hidden>←</span>
        Back to the home page
      </Link>
    </div>
  );
}
