import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { bigintId, readJson } from '../../platform/http';
import { LIMITS, RateLimiter } from '../../platform/rate-limit';
import type { Clock } from '../../platform/clock';
import { route, type GuardOptions } from '../auth/guard';
import type { RecommendService } from './service';

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,120}$/);

const prefsBody = z
  .object({
    categories: z.array(slug).max(10),
    keywords: z.array(z.string().trim().min(2).max(40)).max(15),
    location_slugs: z.array(slug).max(10),
    alerts_enabled: z.boolean(),
    personalize: z.boolean(),
  })
  .strict();

const interactionBody = z
  .object({
    kind: z.enum(['view', 'search', 'listing_click']),
    opportunity_id: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    listing_id: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    term: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

const readBody = z
  .object({
    ids: z
      .array(z.string().regex(/^\d{1,20}$/))
      .max(100)
      .optional(),
    all: z.boolean().optional(),
  })
  .strict();

/** Interests, activity, suggestions and notifications for the signed-in person (plan v1.3). */
export function registerRecommend(
  app: FastifyInstance,
  deps: { service: RecommendService; clock: Clock; guard: GuardOptions },
): void {
  const { service, clock, guard } = deps;
  const beacon = new RateLimiter({ capacity: 120, refillPerSecond: 2 });
  const heavy = new RateLimiter(LIMITS.search);
  const similarByIp = new RateLimiter(LIMITS.publicGet);
  const r = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    handler: Parameters<typeof route>[2]['handler'],
  ) => route(app, guard, { method, url, access: 'authenticated', handler });
  const limited = (rl: RateLimiter, key: string) => {
    const t = rl.take(key, clock.now().getTime());
    if (!t.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Please wait.', undefined, {
        'retry-after': String(t.retryAfterSeconds),
      });
    }
  };

  r('GET', '/api/v1/me/preferences', async (req) => {
    const uid = req.auth!.userId;
    return {
      data: {
        ...(await service.getPreferences(uid)),
        activity_count: await service.activityCount(uid),
      },
    };
  });

  r('PUT', '/api/v1/me/preferences', async (req) => {
    const b = prefsBody.parse(readJson(req));
    return { data: await service.setPreferences(req.auth!.userId, b) };
  });

  r('DELETE', '/api/v1/me/activity', async (req) => ({
    data: { deleted: await service.clearActivity(req.auth!.userId) },
  }));

  r('POST', '/api/v1/me/interactions', async (req, reply) => {
    limited(beacon, req.auth!.userId);
    const b = interactionBody.parse(readJson(req));
    if (b.kind === 'view' && !b.opportunity_id) {
      throw new AppError('VALIDATION_ERROR', 'A view needs an opportunity.');
    }
    if (b.kind === 'listing_click' && !b.listing_id) {
      throw new AppError('VALIDATION_ERROR', 'A web job click needs a listing.');
    }
    if (b.kind === 'search' && !b.term) {
      throw new AppError('VALIDATION_ERROR', 'A search needs a term.');
    }
    await service.record(req.auth!.userId, {
      kind: b.kind,
      ...(b.opportunity_id ? { opportunityId: bigintId(b.opportunity_id) } : {}),
      ...(b.listing_id ? { listingId: bigintId(b.listing_id) } : {}),
      ...(b.term ? { term: b.term } : {}),
    });
    return reply.status(204).send();
  });

  r('GET', '/api/v1/me/recommendations', async (req) => {
    limited(heavy, req.auth!.userId);
    const q = z
      .object({
        locale: z.enum(['bn', 'en']).default('bn'),
        limit: z.coerce.number().int().min(1).max(20).default(8),
      })
      .parse(req.query);
    return { data: await service.recommend(req.auth!.userId, q.locale, q.limit) };
  });

  r('GET', '/api/v1/me/notifications', async (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        unread: z.enum(['1', '0']).optional(),
      })
      .parse(req.query);
    await service.refreshNotifications(req.auth!.userId);
    const { items, unread } = await service.notifications(req.auth!.userId, {
      limit: q.limit,
      unreadOnly: q.unread === '1',
    });
    return { data: items, meta: { unread } };
  });

  r('GET', '/api/v1/me/notifications/unread-count', async (req) => {
    limited(beacon, req.auth!.userId);
    await service.refreshNotifications(req.auth!.userId);
    return { data: { unread: await service.unreadCount(req.auth!.userId) } };
  });

  r('POST', '/api/v1/me/notifications/read', async (req) => {
    const b = readBody.parse(readJson(req));
    const n = await service.markRead(req.auth!.userId, b.all ? 'all' : (b.ids ?? []));
    return { data: { updated: n, unread: await service.unreadCount(req.auth!.userId) } };
  });

  r('GET', '/api/v1/me/feed', async (req) => {
    limited(heavy, req.auth!.userId);
    const q = z
      .object({
        locale: z.enum(['bn', 'en']).default('bn'),
        category: slug.optional(),
        location: slug.optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        offset: z.coerce.number().int().min(0).max(1000).default(0),
      })
      .parse(req.query);
    const out = await service.feed(req.auth!.userId, q.locale, {
      ...(q.category ? { category: q.category } : {}),
      ...(q.location ? { location: q.location } : {}),
      limit: q.limit,
      offset: q.offset,
    });
    return {
      data: out.items,
      meta: { total: out.total, limit: q.limit, offset: q.offset, personalised: out.personalised },
    };
  });

  r('GET', '/api/v1/me/web-jobs', async (req) => {
    limited(heavy, req.auth!.userId);
    const q = z
      .object({
        q: z.string().trim().max(120).optional(),
        source: z.enum(['arbeitnow', 'remotive', 'google']).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        offset: z.coerce.number().int().min(0).max(600).default(0),
      })
      .parse(req.query);
    const out = await service.webFeed(req.auth!.userId, {
      ...(q.q ? { q: q.q } : {}),
      ...(q.source ? { source: q.source } : {}),
      limit: q.limit,
      offset: q.offset,
    });
    return {
      data: out.items,
      meta: { total: out.total, limit: q.limit, offset: q.offset, personalised: out.personalised },
    };
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/opportunities/:id/similar',
    access: 'public',
    handler: async (req) => {
      limited(similarByIp, req.ip);
      const q = z
        .object({
          locale: z.enum(['bn', 'en']).default('bn'),
          limit: z.coerce.number().int().min(1).max(8).default(4),
        })
        .parse(req.query);
      return {
        data: await service.similar(bigintId((req.params as { id: string }).id), q.locale, q.limit),
      };
    },
  });
}
