interface SectionHeadingProps {
  /** `01`, `02`, … in page order. */
  index: string;
  /** The "terminal command" shown above the title, e.g. `cat about.md`. */
  command: string;
  title: string;
}

/** Section title in the site's terminal style: `01 // $ cat about.md`, then a large heading. */
export function SectionHeading({ index, command, title }: SectionHeadingProps) {
  return (
    <div className="mb-10 sm:mb-14">
      <p className="font-mono text-xs text-zinc-500 sm:text-sm">
        <span className="text-emerald-400">{index}</span>
        <span className="mx-2 text-zinc-700">{'//'}</span>
        <span className="text-zinc-600">$</span> {command}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}
