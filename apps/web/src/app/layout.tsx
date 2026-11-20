import type { Metadata, Viewport } from 'next';
import { Fraunces } from 'next/font/google';
import { Suspense, type ReactNode } from 'react';
import { PageViewBeacon } from '@/components/page-view-beacon';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

/**
 * Headings use Fraunces, a soft serif (the `font-display` utility, globals.css). next/font
 * downloads it when the site is built and serves it from this site: visitors' browsers never
 * contact Google, and the text does not jump when the font arrives.
 */
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Zhu Yicheng', template: '%s · Zhu Yicheng' },
  description: 'Personal portfolio: experience, projects and how to get in touch.',
};

export const viewport: Viewport = {
  themeColor: '#faf7f2',
  colorScheme: 'light',
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
    <html lang="en" data-scroll-behavior="smooth" className={fraunces.variable}>
      <body className="min-h-svh bg-canvas text-body antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-brand focus:px-3 focus:py-2 focus:text-white"
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
