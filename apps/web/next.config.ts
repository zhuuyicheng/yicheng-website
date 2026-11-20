import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // For the Docker image (DESIGN.md §14.2): `next build` also writes .next/standalone, a small
  // server.js plus only the node_modules files the pages use.
  output: 'standalone',
  // Trace files from the repository root, so the workspace package @portfolio/shared (outside
  // apps/web) is included in the standalone folder.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Projects used to live under /projects/<slug>; links shared before the move keep working.
  // The privacy notice was removed, so its address goes to the home page.
  redirects: () =>
    Promise.resolve([
      { source: '/projects', destination: '/#projects', permanent: true },
      { source: '/projects/:slug', destination: '/:slug', permanent: true },
      { source: '/privacy', destination: '/', permanent: true },
    ]),
};

export default nextConfig;
