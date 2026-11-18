import type { Metadata } from 'next';
import { StatusDashboard } from '@/components/status-dashboard';

export const metadata: Metadata = {
  title: 'System status',
  description: 'Live health, latency, cache and queue numbers of the API behind this site.',
};

/**
 * The live dashboard. The page itself is static (prerendered at build time); the numbers are
 * fetched by the browser, every 5 s, straight from the API (components/status-dashboard.tsx).
 */
export default function StatusPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <p className="font-mono text-xs text-zinc-500 sm:text-sm">
        <span className="text-zinc-600">$</span> watch -n 5 curl -s /api/v1/system/status
      </p>
      <h1 className="mt-3 mb-10 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
        System status
      </h1>
      <StatusDashboard />
    </div>
  );
}
