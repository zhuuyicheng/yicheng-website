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
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h3 className="text-sm text-body">{props.title}</h3>
      {props.rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{props.empty}</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {props.rows.map((row) => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink" title={row.label}>
                  {row.label}
                </span>
                <span className="shrink-0 text-muted tabular-nums">{row.value}</span>
              </div>
              {row.detail !== undefined && <p className="text-xs text-muted">{row.detail}</p>}
              <div className="mt-1.5 h-1.5 rounded-full bg-sunken">
                <div
                  className="h-full rounded-full bg-brand"
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
