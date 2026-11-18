import Link from 'next/link';

/** Unknown URLs and unknown project slugs. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-32 font-mono text-sm sm:px-6">
      <p className="text-zinc-500">
        <span className="text-zinc-600">$</span> cd ./this-page
      </p>
      <p className="mt-2 text-rose-400">cd: no such file or directory (404)</p>
      <Link href="/" className="mt-8 inline-block text-emerald-300 hover:underline">
        ← cd ~
      </Link>
    </div>
  );
}
