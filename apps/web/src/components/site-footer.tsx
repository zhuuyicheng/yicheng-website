import Link from 'next/link';

/** Footer: the full project list and the privacy notice. */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/5">
      <nav
        aria-label="Footer"
        className="mx-auto flex max-w-6xl justify-end px-4 py-8 text-xs text-zinc-500 sm:px-6"
      >
        <ul className="flex gap-5">
          <li>
            <Link href="/projects" className="hover:text-zinc-300">
              Projects
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="hover:text-zinc-300">
              Privacy
            </Link>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
