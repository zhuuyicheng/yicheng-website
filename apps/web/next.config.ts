import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // For the Docker image (DESIGN.md §14.2): a small server.js and only the files the pages use.
  output: 'standalone',
  // From the repository root, so @portfolio/shared (outside apps/web) is included.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Old /projects/<slug> links keep working; the removed privacy page goes home.
  redirects: () =>
    Promise.resolve([
      { source: '/projects', destination: '/#projects', permanent: true },
      { source: '/projects/:slug', destination: '/:slug', permanent: true },
      { source: '/privacy', destination: '/', permanent: true },
    ]),
};

export default nextConfig;
