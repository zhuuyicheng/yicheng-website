import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
