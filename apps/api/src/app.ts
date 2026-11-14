import Fastify, { type FastifyInstance } from 'fastify';
import { AppError, errorHandler } from './platform/errors';
import { type Clock, systemClock } from './platform/clock';
import type { Config } from './platform/config';
import { ReplayCache, verifyInternal } from './platform/hmac';
import { loggerOptions } from './platform/logger';
import { LIMITS, RateLimiter } from './platform/rate-limit';
import { registerSecurityHeaders } from './platform/security-headers';
import type { Mailer } from './modules/email/mailer';
import type { AuthRepo } from './modules/auth/repo';
import { guardOptionsFor, registerAuth } from './modules/auth/routes';
import type { AdminRepo } from './modules/admin/repo';
import type { ApplicationRepo } from './modules/applications/repo';
import { registerApplications } from './modules/applications/routes';
import { registerAdmin } from './modules/admin/routes';
import type { ListingRepo } from './modules/listings/repo';
import { registerListings } from './modules/listings/routes';
import type { MeRepo } from './modules/me/repo';
import { registerMe } from './modules/me/routes';
import type { OpportunityRepo } from './modules/opportunities/repo';
import { registerOpportunities } from './modules/opportunities/routes';

export interface ReadinessCheck {
  name: string;
  check: () => Promise<boolean>;
}

export interface AppDeps {
  config: Config;
  clock?: Clock;
  readiness?: ReadinessCheck[];
  /** Called by the signed tick endpoint; enqueues due periodic work (plan SCH-03). */
  onTick?: () => Promise<{ enqueued: number }>;
  /** Identity module (needs the database). Omitted in platform-only tests. */
  auth?: { repo: AuthRepo; mailer: Mailer };
  /** Public opportunity browse, detail and search (needs the database). */
  opportunities?: { repo: OpportunityRepo };
  /** Profile, saved, tracker, eligibility (signed-in user). */
  me?: { repo: MeRepo };
  /** Staff API (permissions + second factor). */
  admin?: { repo: AdminRepo };
  applications?: { repo: ApplicationRepo };
  listings?: { repo: ListingRepo };
}

/** Build the Fastify app. Routes are added per module; this is the platform skeleton (Phase 0). */
export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const clock = deps.clock ?? systemClock;
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : loggerOptions(config.LOG_LEVEL),
    genReqId: () => `req_${Math.random().toString(36).slice(2, 12)}`,
    bodyLimit: 1_048_576,
    trustProxy: false, // enabled only after gate S-5 decides how client IPs reach the API (SEC-37)
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => {
    void reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Not found.', request_id: req.id } });
  });
  registerSecurityHeaders(app, config.APP_ENV === 'production');

  const limiter = new RateLimiter(LIMITS.publicGet);
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/internal/') || req.url === '/healthz' || req.url === '/') return;
    const r = limiter.take(`${req.ip}:public`, clock.now().getTime());
    void reply.header('ratelimit-remaining', String(r.remaining));
    if (!r.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', undefined, {
        'retry-after': String(r.retryAfterSeconds),
      });
    }
  });

  // Landing page so the bare service URL is not a JSON 404 (plan 12.1 keeps the API under /api/v1).
  app.get('/', async (req, reply) => {
    if ((req.headers.accept ?? '').includes('application/json')) {
      return { service: 'circular2action-api', status: 'ok', health: '/healthz', ready: '/readyz' };
    }
    const web = config.WEB_ORIGIN;
    return reply
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Circular2Action API</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#17201f;background:#faf8f4}a{color:#0b5d5e}code{background:#f1eee7;padding:2px 6px;border-radius:2px}</style></head><body><h1>Circular2Action API</h1><p>This is the API service (staging). The website is a separate app.</p><ul><li><a href="${web}">Open the website</a></li><li><a href="/healthz"><code>/healthz</code></a> liveness</li><li><a href="/readyz"><code>/readyz</code></a> readiness (database)</li></ul></body></html>`,
      );
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    const results = await Promise.all(
      (deps.readiness ?? []).map(async (c) => {
        try {
          return { name: c.name, ok: await c.check() };
        } catch {
          return { name: c.name, ok: false };
        }
      }),
    );
    const ok = results.every((r) => r.ok);
    return reply
      .status(ok ? 200 : 503)
      .send({ status: ok ? 'ready' : 'unavailable', checks: results });
  });

  // Signed tick (SCH-03). Raw body is needed for the signature.
  const replay = new ReplayCache();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });
  app.post('/internal/tick', async (req, reply) => {
    const body = typeof req.body === 'string' ? req.body : '';
    const result = verifyInternal({
      secrets: config.hmacSecrets,
      timestamp: req.headers['x-c2a-timestamp'] as string | undefined,
      signature: req.headers['x-c2a-signature'] as string | undefined,
      body,
      nowMs: clock.now().getTime(),
      replay,
    });
    if (result !== 'ok') {
      req.log.warn({ result }, 'internal tick rejected');
      return reply.status(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Invalid signature.', request_id: req.id },
      });
    }
    const out = deps.onTick ? await deps.onTick() : { enqueued: 0 };
    return reply.status(202).send({ data: out });
  });

  const guard = guardOptionsFor({
    appEnv: config.APP_ENV,
    webOrigin: config.WEB_ORIGIN,
    webOriginsExtra: config.webOriginsExtra,
    secret: config.hmacSecrets[0]!,
  });
  if (deps.opportunities)
    registerOpportunities(app, { repo: deps.opportunities.repo, clock, guard });
  if (deps.admin) registerAdmin(app, { repo: deps.admin.repo, guard });
  if (deps.me && deps.opportunities) {
    registerMe(app, { repo: deps.me.repo, opportunities: deps.opportunities.repo, clock, guard });
  }

  if (deps.me && deps.opportunities && deps.applications) {
    registerApplications(app, {
      repo: deps.applications.repo,
      me: deps.me.repo,
      opportunities: deps.opportunities.repo,
      clock,
      guard,
    });
  }

  if (deps.listings) registerListings(app, { repo: deps.listings.repo, guard });

  if (deps.auth) {
    registerAuth(app, {
      ...deps.auth,
      clock,
      appEnv: config.APP_ENV,
      webOrigin: config.WEB_ORIGIN,
      webOriginsExtra: config.webOriginsExtra,
      secret: config.hmacSecrets[0]!,
      emailVerificationRequired: config.EMAIL_VERIFICATION_REQUIRED,
    });
  }

  return app;
}
