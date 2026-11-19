import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { bigintId, readJson } from '../../platform/http';
import { route, type GuardOptions } from '../auth/guard';
import type { ListingRepo } from './repo';
import { SOURCE_IDS } from './sources';

const SOURCES = SOURCE_IDS;

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  source: z.enum(SOURCES).optional(),
  category: z.enum(['jobs', 'internships', 'scholarships']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const actorOf = (req: FastifyRequest) => ({
  id: req.auth!.userId,
  role: req.auth!.roles.find((r) => r !== 'user') ?? 'user',
});

/** Jobs found on the web: public read side (always labelled as external) and the staff controls. */
export function registerListings(
  app: FastifyInstance,
  deps: { repo: ListingRepo; guard: GuardOptions },
): void {
  const { repo, guard } = deps;

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/listings',
    access: 'public',
    handler: async (req) => {
      const q = listQuery.parse(req.query);
      repo.refreshIfStale();
      const { items, total } = await repo.list({
        ...(q.q ? { q: q.q } : {}),
        ...(q.source ? { source: q.source } : {}),
        ...(q.category ? { category: q.category } : {}),
        limit: q.limit,
        offset: q.offset,
      });
      return {
        data: items.map(({ hidden: _hidden, ...rest }) => rest),
        meta: { total, limit: q.limit, offset: q.offset },
      };
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/listings/:id',
    access: 'public',
    handler: async (req) => {
      const row = await repo.get(bigintId((req.params as { id: string }).id));
      if (!row) throw new AppError('NOT_FOUND', 'Listing not found.');
      const { hidden: _hidden, ...rest } = row;
      return { data: rest };
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/listings/sources',
    access: 'public',
    handler: async () => ({
      data: (await repo.sources())
        .filter((s) => s.enabled)
        .map(({ id, label, homepage, listings }) => ({ id, label, homepage, listings })),
    }),
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/listings',
    access: 'listing.manage',
    handler: async (req) => {
      const q = listQuery.parse(req.query);
      const { items, total } = await repo.list({
        ...(q.q ? { q: q.q } : {}),
        ...(q.source ? { source: q.source } : {}),
        limit: q.limit,
        offset: q.offset,
        includeHidden: true,
      });
      return {
        data: items,
        meta: { total, limit: q.limit, offset: q.offset, sources: await repo.sources() },
      };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/listings/refresh',
    access: 'listing.manage',
    handler: async (req) => {
      const b = z
        .object({ source: z.enum(SOURCES).optional() })
        .strict()
        .parse(readJson(req) ?? {});
      const results = await repo.refresh(b.source);
      const actor = actorOf(req);
      await repo.audit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'listing.refresh',
        metadata: { source: b.source ?? 'all', results },
        requestId: req.id,
      });
      return { data: { results, sources: await repo.sources() } };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/listings/:id/hidden',
    access: 'listing.manage',
    handler: async (req) => {
      const id = bigintId((req.params as { id: string }).id);
      const b = z.object({ hidden: z.boolean() }).strict().parse(readJson(req));
      if (!(await repo.setHidden(id, b.hidden)))
        throw new AppError('NOT_FOUND', 'Listing not found.');
      const actor = actorOf(req);
      await repo.audit({
        actorId: actor.id,
        actorRole: actor.role,
        action: b.hidden ? 'listing.hide' : 'listing.unhide',
        targetId: id,
        requestId: req.id,
      });
      return { data: { id, hidden: b.hidden } };
    },
  });
}
