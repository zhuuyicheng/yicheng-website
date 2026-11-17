/** Phase 1 placeholder. Real content and the live dashboard arrive in Phase 5. */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <p className="font-mono text-sm text-emerald-400">status: under construction</p>
      <h1 className="text-4xl font-semibold tracking-tight">Portfolio &amp; Live Telemetry</h1>
      <p className="text-lg text-zinc-400">
        A personal portfolio backed by a production-style TypeScript API: cache-aside reads,
        asynchronous event ingestion, rate limiting, and background jobs, all observable live.
      </p>
    </main>
  );
}
