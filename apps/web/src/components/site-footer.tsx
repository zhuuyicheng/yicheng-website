import Link from 'next/link';
import { SectionLink } from './section-link';

const LINKS = [
  { id: 'about', label: 'About' },
  { id: 'projects', label: 'Projects' },
  { id: 'contact', label: 'Contact' },
] as const;

/** Links back to the home page's sections, and the privacy notice. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <nav
        aria-label="Footer"
        className="mx-auto flex max-w-6xl justify-end px-4 py-8 text-xs text-muted sm:px-6"
      >
        <ul className="flex gap-5">
          {LINKS.map((link) => (
            <li key={link.id}>
              <SectionLink id={link.id} className="hover:text-body">
                {link.label}
              </SectionLink>
            </li>
          ))}
          <li>
            {/* A static page whose title needs no API request, so prefetching it is free. */}
            <Link href="/privacy" prefetch className="hover:text-body">
              Privacy
            </Link>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
