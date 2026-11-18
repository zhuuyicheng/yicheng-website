/** A section's title on the home page and the projects page. */
export function SectionHeading({ title }: { title: string }) {
  return (
    <h2 className="mb-10 text-3xl font-semibold tracking-tight text-zinc-50 sm:mb-14 sm:text-4xl">
      {title}
    </h2>
  );
}
