import type { Metadata, Viewport } from 'next';
import { Fraunces } from 'next/font/google';
import { Suspense, type ReactNode } from 'react';
import { PageViewBeacon } from '@/components/page-view-beacon';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

/**
 * Fraunces for headings (`font-display`). next/font serves it from this site: no request to
 * Google, and no text jump when it loads.
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
 * Every page: header, content, footer and the page-view beacon (in <Suspense>: it reads the
 * query string). `data-scroll-behavior="smooth"` keeps page changes instant despite smooth
 * scrolling in globals.css.
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
