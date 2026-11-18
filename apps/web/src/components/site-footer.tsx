import Link from 'next/link';

/** Footer: what the site runs on, and the privacy notice. */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/5">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 font-mono text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="text-emerald-400">●</span> built with Next.js, Fastify, PostgreSQL and
          Redis
        </p>
        <nav aria-label="Footer">
          <ul className="flex gap-5">
            <li>
              <Link href="/projects" className="hover:text-zinc-300">
                ./projects
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="hover:text-zinc-300">
                ./privacy
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
