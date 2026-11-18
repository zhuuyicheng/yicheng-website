import Link from 'next/link';
import { PERIODS } from '@/lib/visitors';

/** Today / 7 / 30 / 90 days, as links (`?days=`), so a period can be bookmarked or reloaded. */
export function PeriodPicker({ days }: { days: number }) {
  return (
    <nav aria-label="Period" className="flex flex-wrap gap-2">
      {PERIODS.map((period) => {
        const active = period.days === days;
        return (
          <Link
            key={period.days}
            href={`/admin?days=${String(period.days)}`}
            aria-current={active ? 'page' : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
              active
                ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
                : 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200'
            }`}
          >
            {period.label}
          </Link>
        );
      })}
    </nav>
  );
}
