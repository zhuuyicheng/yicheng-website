import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DailyVisitorsChart } from '@/components/admin/daily-visitors-chart';
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

/** Written out instead of Next's generated `PageProps` (see projects/[slug]/page.tsx). */
interface AdminPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The owner's private dashboard (DESIGN.md §8.7): who visited and how they found the site,
 * then the live system status. proxy.ts asks for the password; this page checks it again, so
 * it never renders for anyone else even if the proxy's matcher missed it.
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
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
            Owner dashboard
          </h1>
          <p className="mt-2 text-sm text-zinc-500">Only you can see this page.</p>
        </div>
        <PeriodPicker days={days} />
      </header>
      <div className="mt-4">
        <OwnerBrowserToggle />
      </div>

      <Section title="Visitors">
        {summary.truncated && (
          <p className="mb-4 text-sm text-amber-300">
            This period had more visits than one summary reads; the numbers cover the newest 20,000.
          </p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Visits" value={summary.totals.visits} />
          <Stat label="Page views" value={summary.totals.pageViews} />
          <Stat label="Link clicks" value={summary.totals.clicks} />
        </div>
        <div className="mt-4">
          <DailyVisitorsChart days={summary.daily} />
        </div>
      </Section>

      <Section title="How they found the site">
        <div className="grid gap-4 md:grid-cols-2">
          <RankedList
            title="Referring sites"
            empty="No visits yet."
            rows={summary.referrers.map((row) => ({
              key: row.referrer ?? '(direct)',
              label: referrerLabel(row.referrer),
              value: row.visits,
            }))}
          />
          <RankedList
            title="Tagged links (?ref= and utm_*)"
            empty="No visits from tagged links. Share links like /?ref=acme to see them here."
            rows={summary.campaigns.map((row) => ({
              key: JSON.stringify(row),
              label: campaignLabel(row),
              value: row.visits,
            }))}
          />
        </div>
      </Section>

      <Section title="Who they are">
        <div className="grid gap-4 md:grid-cols-2">
          <RankedList
            title="Organisations (network owners)"
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
            empty="No locations yet."
            rows={summary.locations.map((row) => ({
              key: `${row.countryCode ?? ''}|${row.city ?? ''}`,
              label: placeLabel(row.countryCode, row.city),
              value: row.visits,
            }))}
          />
          <RankedList
            title="Devices"
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
        <p className="mt-3 text-xs text-zinc-600">
          One row per visit (a browser tab), newest first. Places and organisations come from the
          visitor&apos;s IP address, which is never stored. IP Geolocation by DB-IP.
        </p>
      </Section>

      <Section title="System status">
        <StatusDashboard />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="mb-5 text-xl font-semibold tracking-tight text-zinc-50">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl text-zinc-50 tabular-nums sm:text-3xl">{value}</p>
    </div>
  );
}
