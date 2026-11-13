import type { FastifyInstance } from 'fastify';

/** Security headers for API responses (plan SEC-12). The API returns JSON only, so the CSP forbids everything. */
export const API_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-site',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'cache-control': 'no-store',
};

export function registerSecurityHeaders(app: FastifyInstance, isProduction: boolean): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) {
      // public cacheable routes may set their own cache-control
      if (k === 'cache-control' && reply.hasHeader('cache-control')) continue;
      void reply.header(k, v);
    }
    if (isProduction)
      void reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains');
    void reply.removeHeader('x-powered-by');
    return payload;
  });
}
