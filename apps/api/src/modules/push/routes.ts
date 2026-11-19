import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../platform/clock';
import { AppError } from '../../platform/errors';
import { readJson } from '../../platform/http';
import { LIMITS, RateLimiter } from '../../platform/rate-limit';
import { route, type GuardOptions } from '../auth/guard';
import { isPushEndpoint, PUSH_TYPES, type PushService } from './service';

const subscribeBody = z
  .object({
    endpoint: z.string().url().max(1000).refine(isPushEndpoint, 'Not a supported push service'),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/),
        auth: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/),
      })
      .strict(),
  })
  .strict();

const unsubscribeBody = z.object({ endpoint: z.string().url().max(1000) }).strict();
const typeBody = z.object({ type: z.enum(PUSH_TYPES), enabled: z.boolean() }).strict();

/** Push notification settings of the signed-in person (seeker, employer or staff). */
export function registerPush(
  app: FastifyInstance,
  deps: {
    push: PushService;
    clock: Clock;
    guard: GuardOptions;
    locale: (userId: string) => Promise<string>;
  },
): void {
  const { push, clock, guard } = deps;
  const limiter = new RateLimiter(LIMITS.search);
  const testLimiter = new RateLimiter({ capacity: 3, refillPerSecond: 3 / 300 });
  const r = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    handler: Parameters<typeof route>[2]['handler'],
  ) => route(app, guard, { method, url, access: 'authenticated', handler });

  r('GET', '/api/v1/me/push', async (req) => ({
    data: {
      available: push.enabled,
      public_key: push.publicKey,
      devices: await push.deviceCount(req.auth!.userId),
      disabled_types: await push.disabledTypes(req.auth!.userId),
    },
  }));

  r('POST', '/api/v1/me/push/subscribe', async (req) => {
    if (!push.enabled) throw new AppError('SERVICE_UNAVAILABLE', 'Push is not switched on yet.');
    const t = limiter.take(req.auth!.userId, clock.now().getTime());
    if (!t.allowed) throw new AppError('RATE_LIMITED', 'Too many requests. Please wait.');
    const b = subscribeBody.parse(readJson(req));
    const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    await push.subscribe(req.auth!.userId, b, ua);
    return { data: { devices: await push.deviceCount(req.auth!.userId) } };
  });

  r('POST', '/api/v1/me/push/unsubscribe', async (req) => {
    const b = unsubscribeBody.parse(readJson(req));
    await push.unsubscribe(req.auth!.userId, b.endpoint);
    return { data: { devices: await push.deviceCount(req.auth!.userId) } };
  });

  r('PUT', '/api/v1/me/push/types', async (req) => {
    const b = typeBody.parse(readJson(req));
    await push.setType(req.auth!.userId, b.type, b.enabled);
    return { data: { disabled_types: await push.disabledTypes(req.auth!.userId) } };
  });

  r('POST', '/api/v1/me/push/test', async (req) => {
    if (!push.enabled) throw new AppError('SERVICE_UNAVAILABLE', 'Push is not switched on yet.');
    const t = testLimiter.take(req.auth!.userId, clock.now().getTime());
    if (!t.allowed)
      throw new AppError('RATE_LIMITED', 'Please wait a few minutes before another test.');
    const sent = await push.test(req.auth!.userId, await deps.locale(req.auth!.userId));
    return { data: { sent } };
  });
}
