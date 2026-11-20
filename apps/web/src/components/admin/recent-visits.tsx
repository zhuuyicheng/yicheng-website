import type { Visit } from '@portfolio/shared';
import {
  campaignLabel,
  deviceLabel,
  pagesLabel,
  placeLabel,
  referrerLabel,
  timeAgo,
} from '@/lib/visitors';

/**
 * The newest visits, one row each: when, how they arrived, from where (place, network and IP
 * address), on what, and what they read.
 */
export function RecentVisits({ visits, now }: { visits: readonly Visit[]; now: number }) {
  if (visits.length === 0) {
    return <p className="text-sm text-muted">No visits in this period yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-4 py-3 font-normal">When</th>
            <th className="px-4 py-3 font-normal">Came from</th>
            <th className="px-4 py-3 font-normal">Where</th>
            <th className="px-4 py-3 font-normal">IP address</th>
            <th className="px-4 py-3 font-normal">Device</th>
            <th className="px-4 py-3 font-normal">Pages</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {visits.map((visit) => {
            const tagged = [visit.ref, visit.utmSource, visit.utmMedium, visit.utmCampaign].some(
              (value) => value !== null,
            );
            return (
              <tr key={`${visit.startedAt}-${visit.paths.join()}`} className="align-top">
                <td className="px-4 py-3 whitespace-nowrap text-muted" title={visit.startedAt}>
                  {timeAgo(visit.startedAt, now)}
                </td>
                <td className="px-4 py-3">
                  <span className="text-ink">{referrerLabel(visit.referrer)}</span>
                  {tagged && (
                    <span className="mt-0.5 block text-xs text-brand">{campaignLabel(visit)}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-ink">{placeLabel(visit.countryCode, visit.city)}</span>
                  {visit.organization !== null && (
                    <span className="mt-0.5 block text-xs text-muted">{visit.organization}</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs break-all text-body">
                  {visit.ipAddress ?? <span className="font-sans text-faint">not recorded</span>}
                </td>
                <td className="px-4 py-3 text-muted">{deviceLabel(visit)}</td>
                <td className="px-4 py-3 text-muted">
                  <span className="text-ink tabular-nums">{visit.pageViews}</span>
                  {visit.clicks > 0 && <span className="text-muted"> · {visit.clicks} clicks</span>}
                  <span className="mt-0.5 block text-xs break-all text-muted">
                    {pagesLabel(visit.paths)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
