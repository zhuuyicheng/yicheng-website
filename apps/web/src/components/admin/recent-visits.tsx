import type { Visit } from '@portfolio/shared';
import {
  campaignLabel,
  deviceLabel,
  pagesLabel,
  placeLabel,
  referrerLabel,
  timeAgo,
} from '@/lib/visitors';

/** The newest visits, one row each: when, how they arrived, from where, on what, and what they read. */
export function RecentVisits({ visits, now }: { visits: readonly Visit[]; now: number }) {
  if (visits.length === 0) {
    return <p className="text-sm text-zinc-500">No visits in this period yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-900/40">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="border-b border-white/10 text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-normal">When</th>
            <th className="px-4 py-3 font-normal">Came from</th>
            <th className="px-4 py-3 font-normal">Where</th>
            <th className="px-4 py-3 font-normal">Device</th>
            <th className="px-4 py-3 font-normal">Pages</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {visits.map((visit) => {
            const tagged = [visit.ref, visit.utmSource, visit.utmMedium, visit.utmCampaign].some(
              (value) => value !== null,
            );
            return (
              <tr key={`${visit.startedAt}-${visit.paths.join()}`} className="align-top">
                <td className="px-4 py-3 whitespace-nowrap text-zinc-400" title={visit.startedAt}>
                  {timeAgo(visit.startedAt, now)}
                </td>
                <td className="px-4 py-3">
                  <span className="text-zinc-200">{referrerLabel(visit.referrer)}</span>
                  {tagged && (
                    <span className="mt-0.5 block text-xs text-emerald-300">
                      {campaignLabel(visit)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-zinc-200">{placeLabel(visit.countryCode, visit.city)}</span>
                  {visit.organization !== null && (
                    <span className="mt-0.5 block text-xs text-zinc-500">{visit.organization}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-400">{deviceLabel(visit)}</td>
                <td className="px-4 py-3 text-zinc-400">
                  <span className="text-zinc-200 tabular-nums">{visit.pageViews}</span>
                  {visit.clicks > 0 && (
                    <span className="text-zinc-500"> · {visit.clicks} clicks</span>
                  )}
                  <span className="mt-0.5 block text-xs break-all text-zinc-500">
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
