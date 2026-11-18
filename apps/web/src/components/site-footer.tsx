import Link from 'next/link';

/** Footer: the full project list and the privacy notice. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <nav
        aria-label="Footer"
        className="mx-auto flex max-w-6xl justify-end px-4 py-8 text-xs text-muted sm:px-6"
      >
        <ul className="flex gap-5">
          <li>
            <Link href="/projects" className="hover:text-body">
              Projects
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="hover:text-body">
              Privacy
            </Link>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
