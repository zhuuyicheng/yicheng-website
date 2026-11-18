import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import { PageViewBeacon } from '@/components/page-view-beacon';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Portfolio', template: '%s · Portfolio' },
  description: 'Personal portfolio with a live backend telemetry dashboard.',
};

export const viewport: Viewport = {
  themeColor: '#07090c',
  colorScheme: 'dark',
};

/**
 * Every page: header, content, footer, and the page-view beacon. The beacon renders nothing
 * and sits in <Suspense> because it reads the URL's query string (see page-view-beacon.tsx).
 *
 * `data-scroll-behavior="smooth"`: globals.css scrolls smoothly for in-page links; this tells
 * Next.js to switch that off while it changes pages, so navigation still jumps instantly.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="min-h-svh bg-canvas text-zinc-100 antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-emerald-400 focus:px-3 focus:py-2 focus:text-zinc-950"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <Suspense fallback={null}>
          <PageViewBeacon />
        </Suspense>
      </body>
    </html>
  );
}
