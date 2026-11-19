// Vercel serves the web app; API calls under /api/* are rewritten to the Render API (plan section 9.12, gate S-5),
// so the browser only ever talks to one origin and session cookies stay first-party.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

const isProd = process.env.NODE_ENV === 'production';
// HTTPS-only rules (HSTS, upgrading http subresources) apply on real deployments, not on a local http server.
const isHosted = isProd && Boolean(process.env.APP_ENV) && process.env.APP_ENV !== 'local';

// Content-Security-Policy: everything comes from this origin. Inline scripts and styles stay allowed because Next.js
// inlines its hydration data; frames, plugins, other origins for scripts and form posts are refused.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isHosted ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = isProd
  ? [
      { key: 'Content-Security-Policy', value: csp },
      ...(isHosted
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
        : []),
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ]
  : [];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@c2a/eligibility', '@c2a/dates', '@c2a/contracts'],
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
        // the service worker must never be cached for long, so a fix reaches every device quickly
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, max-age=0' },
          { key: 'Content-Type', value: 'text/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          ...securityHeaders,
          ...(noindex ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
