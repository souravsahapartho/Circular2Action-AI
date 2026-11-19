import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../platform/clock';
import { AppError } from '../../platform/errors';
import { bigintId, readJson } from '../../platform/http';
import { LIMITS, RateLimiter } from '../../platform/rate-limit';
import { route, type GuardOptions } from '../auth/guard';
import type { OpportunityRepo } from '../opportunities/repo';
import type { RecommendService } from '../recommend/service';
import { SPONSOR_DAYS, type SponsoredRepo } from './repo';

const daysBody = z
  .object({
    days: z
      .number()
      .int()
      .refine((d) => (SPONSOR_DAYS as readonly number[]).includes(d)),
  })
  .strict();
const decisionBody = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .strict();
const listQuery = z.object({
  status: z.enum(['pending', 'active', 'rejected', 'ended']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const feedQuery = z.object({
  locale: z.enum(['bn', 'en']).default('bn'),
  limit: z.coerce.number().int().min(1).max(4).default(2),
});

const actorOf = (req: FastifyRequest) => ({
  id: req.auth!.userId,
  role: req.auth!.roles.find((r) => r !== 'user') ?? 'user',
});

/** Fisher-Yates with a plain Math.random: only used to rotate which sponsor is shown, never for security. */
function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Sponsored posts: employers ask, staff decide, and an active one is shown (always labelled "Sponsored") to the
 * people it fits best. The demo plan charges nothing.
 */
export function registerSponsored(
  app: FastifyInstance,
  deps: {
    repo: SponsoredRepo;
    opportunities: OpportunityRepo;
    recommend?: RecommendService;
    clock: Clock;
    guard: GuardOptions;
  },
): void {
  const { repo, opportunities, recommend, clock, guard } = deps;
  const publicLimit = new RateLimiter(LIMITS.publicGet);
  const writeLimit = new RateLimiter(LIMITS.authedWrite);

  // ---- employer ----
  route(app, guard, {
    method: 'GET',
    url: '/api/v1/employer/sponsorships',
    access: 'employer.manage',
    handler: async (req) => ({ data: await repo.listForOwner(req.auth!.userId) }),
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/employer/opportunities/:id/sponsor',
    access: 'employer.manage',
    handler: async (req, reply) => {
      const t = writeLimit.take(req.auth!.userId, clock.now().getTime());
      if (!t.allowed) throw new AppError('RATE_LIMITED', 'Too many requests. Please wait.');
      const b = daysBody.parse(readJson(req));
      const res = await repo.request(
        req.auth!.userId,
        bigintId((req.params as { id: string }).id),
        b.days,
      );
      if (res === 'not_found') throw new AppError('NOT_FOUND', 'Post not found.');
      if (res === 'not_published')
        throw new AppError('CONFLICT', 'Only a live post can be sponsored. Publish it first.');
      if (res === 'exists')
        throw new AppError('CONFLICT', 'This post already has a pending or running sponsorship.');
      return reply.status(201).send({ data: { ok: true } });
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/employer/sponsorships/:id/end',
    access: 'employer.manage',
    handler: async (req) => {
      const ok = await repo.end(req.auth!.userId, bigintId((req.params as { id: string }).id));
      if (!ok) throw new AppError('NOT_FOUND', 'Sponsorship not found or already ended.');
      return { data: { ok: true } };
    },
  });

  // ---- staff ----
  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/sponsorships',
    access: 'listing.manage',
    handler: async (req) => {
      const q = listQuery.parse(req.query);
      const { items, total } = await repo.listAll({
        ...(q.status ? { status: q.status } : {}),
        limit: q.limit,
        offset: q.offset,
      });
      return { data: items, meta: { total, limit: q.limit, offset: q.offset } };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/sponsorships/:id/decision',
    access: 'listing.manage',
    handler: async (req) => {
      const b = decisionBody.parse(readJson(req));
      const res = await repo.decide(
        bigintId((req.params as { id: string }).id),
        b.decision,
        b.note ?? null,
        actorOf(req),
        req.id,
      );
      if (res === 'not_found') throw new AppError('NOT_FOUND', 'Sponsorship not found.');
      if (res === 'not_pending')
        throw new AppError('CONFLICT', 'This request was already decided.');
      return { data: { ok: true } };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/opportunities/:id/sponsor',
    access: 'listing.manage',
    handler: async (req, reply) => {
      const b = daysBody.parse(readJson(req));
      const res = await repo.startByStaff(
        bigintId((req.params as { id: string }).id),
        b.days,
        actorOf(req),
        req.id,
      );
      if (res === 'not_found') throw new AppError('NOT_FOUND', 'Opportunity not found.');
      if (res === 'not_published')
        throw new AppError('CONFLICT', 'Only a published opportunity can be sponsored.');
      return reply.status(201).send({ data: { ok: true } });
    },
  });

  // ---- readers ----
  const cards = async (ids: string[], locale: 'bn' | 'en', scores?: Map<string, unknown>) => {
    const summaries = await opportunities.summaries(ids, locale, clock.now());
    return ids
      .map((id) => summaries.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ ...s, sponsored: true, reasons: scores?.get(s.id) ?? [] }));
  };

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/sponsored',
    access: 'public',
    handler: async (req) => {
      const t = publicLimit.take(req.ip, clock.now().getTime());
      if (!t.allowed) throw new AppError('RATE_LIMITED', 'Too many requests. Please wait.');
      const q = feedQuery.parse(req.query);
      const ids = shuffle(await repo.activeOpportunityIds()).slice(0, q.limit);
      const data = await cards(ids, q.locale);
      void repo.recordImpressions(data.map((d) => d.id)).catch(() => undefined);
      return { data };
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/me/sponsored',
    access: 'authenticated',
    handler: async (req) => {
      const q = feedQuery.parse(req.query);
      const active = await repo.activeOpportunityIds();
      let ids: string[];
      let reasons = new Map<string, unknown>();
      if (recommend && active.length > 0) {
        // the sponsors that fit this person best come first; ones that fit nobody-like-them are shown last
        const ranked = await recommend.scoreIds(req.auth!.userId, active);
        const fitting = ranked.filter((r) => r.score > 0);
        const pool = fitting.length > 0 ? fitting : ranked;
        ids = pool.slice(0, Math.max(q.limit * 3, q.limit)).map((r) => r.id);
        // rotate among the best few so the same sponsor does not always win
        ids = shuffle(ids.slice(0, q.limit + 2)).slice(0, q.limit);
        reasons = new Map(ranked.map((r) => [r.id, r.reasons]));
      } else {
        ids = shuffle(active).slice(0, q.limit);
      }
      const data = await cards(ids, q.locale, reasons);
      void repo.recordImpressions(data.map((d) => d.id)).catch(() => undefined);
      return { data };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/sponsored/:id/click',
    access: 'public',
    handler: async (req) => {
      const t = publicLimit.take(req.ip, clock.now().getTime());
      if (!t.allowed) throw new AppError('RATE_LIMITED', 'Too many requests. Please wait.');
      await repo.recordClick(bigintId((req.params as { id: string }).id));
      return { data: { ok: true } };
    },
  });
}
