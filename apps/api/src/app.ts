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
import { registerAuth } from './modules/auth/routes';

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
    if (req.url.startsWith('/internal/') || req.url === '/healthz') return;
    const r = limiter.take(`${req.ip}:public`, clock.now().getTime());
    void reply.header('ratelimit-remaining', String(r.remaining));
    if (!r.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', undefined, {
        'retry-after': String(r.retryAfterSeconds),
      });
    }
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

  if (deps.auth) {
    registerAuth(app, {
      ...deps.auth,
      clock,
      appEnv: config.APP_ENV,
      webOrigin: config.WEB_ORIGIN,
      secret: config.hmacSecrets[0]!,
    });
  }

  return app;
}
