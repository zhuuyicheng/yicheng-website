import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DailyVisitorsChart } from '@/components/admin/daily-visitors-chart';
import { Explainer } from '@/components/admin/explainer';
import { OwnerBrowserToggle } from '@/components/admin/owner-browser-toggle';
import { PeriodPicker } from '@/components/admin/period-picker';
import { RankedList } from '@/components/admin/ranked-list';
import { RecentVisits } from '@/components/admin/recent-visits';
import { StatusDashboard } from '@/components/status-dashboard';
import { checkOwner } from '@/lib/admin-auth';
import { getVisitorSummary } from '@/lib/admin-api';
import { adminToken } from '@/lib/config';
import {
  campaignLabel,
  capitalise,
  countryName,
  parseDays,
  placeLabel,
  referrerLabel,
  timeAgo,
} from '@/lib/visitors';

export const metadata: Metadata = {
  title: 'Owner dashboard',
  robots: { index: false, follow: false },
};

/** Not Next's generated `PageProps` (see app/[slug]/page.tsx). */
interface AdminPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The owner's dashboard (DESIGN.md §8.7): visitors, then live system status. proxy.ts asks for
 * the password; this page checks it again in case the proxy's matcher missed it.
 */
export default async function AdminPage(props: AdminPageProps) {
  const owner = await checkOwner((await headers()).get('authorization'), adminToken());
  if (owner !== 'owner') {
    notFound();
  }

  const days = parseDays((await props.searchParams).days);
  const summary = await getVisitorSummary(days);
  const now = Date.parse(summary.generatedAt);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Owner dashboard
          </h1>
          <p className="mt-2 text-sm text-muted">Only you can see this page.</p>
        </div>
        <PeriodPicker days={days} />
      </header>
      <div className="mt-4">
        <OwnerBrowserToggle />
      </div>

      <Section title="Visitors">
        {summary.truncated && (
          <p className="mb-4 text-sm text-amber-700">
            This period had more visits than one summary reads; the numbers cover the newest 20,000.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Visits"
            value={summary.totals.visits}
            description="Someone opening the site in a browser tab. Reloading or moving between pages stays one visit."
          />
          <Stat
            label="Page views"
            value={summary.totals.pageViews}
            description="Pages opened during those visits: the home page or a project page."
          />
          <Stat
            label="Link clicks"
            value={summary.totals.clicks}
            description="Clicks on links that leave the site, such as your LinkedIn profile."
          />
        </div>
        <div className="mt-4">
          <DailyVisitorsChart days={summary.daily} />
        </div>
        <div className="mt-4">
          <VisitorCountingExplainer />
        </div>
      </Section>

      <Section title="How they found the site" note="Each list counts visits.">
        <div className="grid gap-4 md:grid-cols-2">
          <RankedList
            title="Referring sites"
            description="The site a visitor clicked a link on to get here. “Direct or unknown” means they typed the address, used a bookmark, or came from an app or site that hides itself."
            empty="No visits yet."
            rows={summary.referrers.map((row) => ({
              key: row.referrer ?? '(direct)',
              label: referrerLabel(row.referrer),
              value: row.visits,
            }))}
          />
          <RankedList
            title="Tagged links (?ref= and utm_*)"
            description="Visits that arrived through a link you labelled before sharing it, like /?ref=acme."
            empty="No visits from tagged links. Share links like /?ref=acme to see them here."
            rows={summary.campaigns.map((row) => ({
              key: JSON.stringify(row),
              label: campaignLabel(row),
              value: row.visits,
            }))}
          />
        </div>
      </Section>

      <Section
        title="Who they are"
        note="Each list counts visits. Organisation and place are looked up from the visitor's IP address."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <RankedList
            title="Organisations (network owners)"
            description="Who owns the network a visit came from: a company when someone browses from its office, otherwise their home or mobile internet provider. A VPN shows the VPN's owner."
            empty="No named networks yet."
            rows={summary.organizations.map((row) => ({
              key: `${row.organization}|${row.countryCode ?? ''}`,
              label: row.organization,
              detail: [
                row.countryCode === null ? null : countryName(row.countryCode),
                `last seen ${timeAgo(row.lastSeenAt, now)}`,
              ]
                .filter((part): part is string => part !== null)
                .join(' · '),
              value: row.visits,
            }))}
          />
          <RankedList
            title="Places"
            description="Where that network is, roughly: often the provider's nearest city rather than the visitor's own."
            empty="No locations yet."
            rows={summary.locations.map((row) => ({
              key: `${row.countryCode ?? ''}|${row.city ?? ''}`,
              label: placeLabel(row.countryCode, row.city),
              value: row.visits,
            }))}
          />
          <RankedList
            title="Devices"
            description="Phone, tablet or computer, as the visitor's browser describes itself."
            empty="No visits yet."
            rows={summary.devices.map((row) => ({
              key: row.deviceType ?? '(unknown)',
              label: row.deviceType === null ? 'Unknown' : capitalise(row.deviceType),
              value: row.visits,
            }))}
          />
          <RankedList
            title="Browsers"
            empty="No visits yet."
            rows={summary.browsers.map((row) => ({
              key: row.browser ?? '(unknown)',
              label: row.browser ?? 'Unknown',
              value: row.visits,
            }))}
          />
        </div>
      </Section>

      <Section title="What they read">
        <div className="grid gap-4 md:grid-cols-2">
          <RankedList
            title="Pages (views)"
            description="How many times each page was opened; underneath, how many different visits opened it."
            empty="No page views yet."
            rows={summary.pages.map((row) => ({
              key: row.path,
              label: row.path,
              detail: `${String(row.visits)} visits`,
              value: row.views,
            }))}
          />
          <RankedList
            title="Link clicks"
            description="Which links to other sites were clicked, and how many times."
            empty="No tracked links clicked yet."
            rows={summary.clicks.map((row) => ({
              key: row.name,
              label: row.name.replace(/^click:/, ''),
              value: row.clicks,
            }))}
          />
        </div>
      </Section>

      <Section title="Recent visits">
        <RecentVisits visits={summary.recentVisits} now={now} />
        <p className="mt-3 text-xs text-faint">
          One row per visit (a browser tab), newest first. Place and organisation are looked up from
          the visitor&apos;s IP address when the visit arrives. IP Geolocation by DB-IP.
        </p>
      </Section>

      <Section
        title="System status"
        note="Is the site's back end healthy? Live numbers from the API, refreshed every 5 seconds while this tab is open."
      >
        <StatusDashboard />
      </Section>
    </div>
  );
}

/** The fine print behind the visitor numbers (DESIGN.md §8.7). */
function VisitorCountingExplainer() {
  return (
    <Explainer summary="How visits, page views and clicks are counted">
      <p>
        <strong className="font-medium text-ink">A visit</strong> lasts as long as the browser tab.
        The site gives each tab a random id (kept in the tab, not a cookie), and every page view and
        click from that tab carries it. Reloading or moving between pages stays one visit; the same
        person opening a second tab, or coming back after closing the tab, makes a new one.
      </p>
      <p>
        <strong className="font-medium text-ink">A page view</strong> is counted every time a page
        is opened or reloaded. Jumping to a section of the home page (About, Projects, Contact) only
        scrolls, so it is not a page view.
      </p>
      <p>
        <strong className="font-medium text-ink">A link click</strong> is counted for links that
        lead to other sites: your profile links and a project&apos;s &ldquo;Live site&rdquo; and
        &ldquo;Source code&rdquo; buttons. Following a link within the site shows up as a page view
        instead.
      </p>
      <p>
        <strong className="font-medium text-ink">Unique visitors per day</strong> (the chart) treats
        the same network address and browser on the same day as one person, so two colleagues in one
        office with the same browser may count as one, and one person on a phone and a laptop as
        two. The chart recognises people afresh every day, on purpose, so its days cannot be added
        up: that is why there is no &ldquo;unique visitors&rdquo; total for the whole period.
      </p>
      <p>
        <strong className="font-medium text-ink">Not counted:</strong> your own browsing from this
        browser (the checkbox above), the /admin pages, search-engine crawlers, and visitors whose
        browser blocks scripts or analytics requests. Days are UTC days, starting at midnight UTC.
      </p>
    </Explainer>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  /** One line under the title saying what the numbers are. */
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-14">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h2>
      {note !== undefined && <p className="mt-1.5 text-sm text-muted">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Stat(props: { label: string; value: number; description: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{props.label}</p>
      <p className="mt-2 text-2xl text-ink tabular-nums sm:text-3xl">{props.value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{props.description}</p>
    </div>
  );
}
