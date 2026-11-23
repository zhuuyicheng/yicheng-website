import Link from 'next/link';

/** Unknown URLs and unknown project slugs. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-32 sm:px-6">
      <p className="text-sm text-muted">404</p>
      <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-ink">
        Page not found
      </h1>
      <p className="mt-4 text-muted">This page doesn&apos;t exist, or it has moved.</p>
      <Link
        href="/"
        prefetch={false} // why: components/section-link.tsx
        className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-5 py-2.5 text-sm font-medium text-ink transition hover:border-brand/60 hover:text-ink"
      >
        <span aria-hidden>←</span>
        Back to the home page
      </Link>
    </div>
  );
}
