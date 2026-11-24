import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SectionLink } from '@/components/section-link';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What this site records about visits and messages, and why.',
};

/**
 * The privacy notice (DESIGN.md §12). Describes exactly what the API stores: see
 * apps/api/src/services/telemetry.manager.ts, visitor-details.manager.ts and
 * contact.manager.ts. Update it whenever what is collected changes.
 *
 * No data fetching, so Next.js renders it once at build time (a static page).
 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
        Privacy
      </h1>
      <p className="mt-5 text-lg text-muted">
        This site records visits so I can see who reads it and what they look at. It uses no
        cookies, no advertising and no third-party analytics: everything below is stored on my own
        server.
      </p>

      <Block title="When you browse">
        <p>For each page you view, and for clicks on some links (such as LinkedIn), I store:</p>
        <ul>
          <li>
            the page, including campaign tags in the link you followed (for example{' '}
            <code>?ref=</code> or <code>utm_source</code>);
          </li>
          <li>the website you came from, as its domain only;</li>
          <li>
            your browser, operating system and type of device, your preferred language and your time
            zone;
          </li>
          <li>
            your IP address, and the country, city and organisation that owns your network (your
            company or your internet provider), looked up from it in a database on my server;
          </li>
          <li>
            a random id for your browser tab, kept in your browser&apos;s session storage until you
            close the tab, and a visitor code that changes every day, so I can count unique visitors
            per day.
          </li>
        </ul>
        <p>
          Your browser&apos;s full identification string is only used to work out the browser,
          system and device, and is then discarded. None of this is sent to anyone else.
        </p>
      </Block>

      <Block title="When you send a message">
        <p>
          The contact form stores your name, email address and message, and a keyed hash of your IP
          address. The hash limits how many messages can be sent from one address and helps spot
          abuse; it cannot be turned back into your IP address. Messages are not linked to your
          browsing.
        </p>
        <p>
          I receive each message as a notification in a private Discord channel, so its name, email
          address and text pass through Discord&apos;s servers.
        </p>
      </Block>

      <Block title="Who can see it">
        <p>
          Only me, on a password-protected page of this site. Nothing about visitors is shown
          publicly. Backups of the database, which include these records, are kept on my server and
          copied to my own computer.
        </p>
      </Block>

      <Block title="How long it is kept">
        <p>
          There is no automatic deletion: records, IP addresses included, are kept until I remove
          them.
        </p>
      </Block>

      <Block title="Your choices">
        <p>
          The site works the same if a content blocker stops the visit records. To ask what I have
          about you, or to have it deleted, write to me through the{' '}
          <SectionLink id="contact">contact form</SectionLink>.
        </p>
      </Block>

      <Block title="Credits">
        <p>
          <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">
            IP Geolocation by DB-IP
          </a>
          , licensed under{' '}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
          >
            CC BY 4.0
          </a>
          .
        </p>
      </Block>

      <p className="mt-16 text-xs text-faint">Last updated: 25 November 2026</p>
    </article>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-body [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-sm [&_code]:text-ink [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
