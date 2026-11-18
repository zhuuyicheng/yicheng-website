import { share } from '@/lib/visitors';

export interface RankedRow {
  key: string;
  label: string;
  /** A second, quieter line, e.g. a country or "last seen 3 h ago". */
  detail?: string;
  value: number;
}

/** A top-N list: label and count on one line, a thin bar under it scaled to the largest. */
export function RankedList(props: { title: string; rows: readonly RankedRow[]; empty: string }) {
  const max = Math.max(0, ...props.rows.map((row) => row.value));
  return (
    <section className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 sm:p-5">
      <h3 className="text-sm text-zinc-300">{props.title}</h3>
      {props.rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{props.empty}</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {props.rows.map((row) => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-zinc-200" title={row.label}>
                  {row.label}
                </span>
                <span className="shrink-0 text-zinc-400 tabular-nums">{row.value}</span>
              </div>
              {row.detail !== undefined && <p className="text-xs text-zinc-500">{row.detail}</p>}
              <div className="mt-1.5 h-1.5 rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-emerald-400"
                  style={{ width: `${String(share(row.value, max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
