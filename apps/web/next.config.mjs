// Vercel serves the web app; API calls under /api/* are rewritten to the Render API (plan section 9.12, gate S-5),
// so the browser only ever talks to one origin and session cookies stay first-party.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@c2a/eligibility', '@c2a/dates'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/api-health/live', destination: `${API_ORIGIN}/healthz` },
      { source: '/api-health/ready', destination: `${API_ORIGIN}/readyz` },
    ];
  },
  async headers() {
    const noindex = process.env.APP_ENV !== 'production';
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          ...(noindex ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
