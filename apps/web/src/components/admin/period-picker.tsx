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
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-line text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {period.label}
          </Link>
        );
      })}
    </nav>
  );
}
