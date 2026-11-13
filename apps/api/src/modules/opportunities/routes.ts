import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../platform/clock';
import { AppError } from '../../platform/errors';
import { LIMITS, RateLimiter } from '../../platform/rate-limit';
import { route, type GuardOptions } from '../auth/guard';
import type { OpportunityRepo } from './repo';

const listQuery = z.object({
  locale: z.enum(['bn', 'en']).default('bn'),
  category: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const searchQuery = listQuery.extend({ q: z.string().trim().min(1).max(200) });
const idParam = z.object({ id: z.string().regex(/^\d{1,20}$/) });
const localeQuery = z.object({ locale: z.enum(['bn', 'en']).default('bn') });

/** Public read endpoints (plan 12.2). Only published, open opportunities are returned. */
export function registerOpportunities(
  app: FastifyInstance,
  deps: { repo: OpportunityRepo; clock: Clock; guard: GuardOptions },
): void {
  const { repo, clock, guard } = deps;
  const searchLimiter = new RateLimiter(LIMITS.search);

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/opportunities',
    access: 'public',
    handler: async (req) => {
      const q = listQuery.parse(req.query);
      const { items, total } = await repo.list({ ...q, now: clock.now() });
      return { data: items, meta: { total, limit: q.limit, offset: q.offset } };
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/search',
    access: 'public',
    handler: async (req) => {
      const r = searchLimiter.take(`${req.ip}:search`, clock.now().getTime());
      if (!r.allowed) {
        throw new AppError('RATE_LIMITED', 'Too many searches. Please wait a moment.', undefined, {
          'retry-after': String(r.retryAfterSeconds),
        });
      }
      const q = searchQuery.parse(req.query);
      const { items, total } = await repo.list({ ...q, now: clock.now() });
      return { data: items, meta: { total, limit: q.limit, offset: q.offset } };
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/opportunities/:id',
    access: 'public',
    handler: async (req) => {
      const { id } = idParam.parse(req.params);
      const { locale } = localeQuery.parse(req.query);
      const o = await repo.get(id, locale, clock.now());
      if (!o) throw new AppError('NOT_FOUND', 'Opportunity not found.');
      return { data: o };
    },
  });
}
