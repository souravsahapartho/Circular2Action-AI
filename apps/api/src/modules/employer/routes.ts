import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../platform/clock';
import { AppError } from '../../platform/errors';
import { bigintId, readJson } from '../../platform/http';
import { LIMITS, RateLimiter } from '../../platform/rate-limit';
import { opportunityBody, toInput } from '../admin/routes';
import { SITE_STATUSES } from '../applications/logic';
import type { ApplicationRepo } from '../applications/repo';
import { route, type GuardOptions } from '../auth/guard';
import type { EmployerRepo } from './repo';

const createBody = opportunityBody.omit({ organization_id: true });
const patchBody = createBody.partial().extend({ updated_at: z.string().datetime() }).strict();

const companyBody = z
  .object({
    company_name: z.string().trim().min(2).max(200).optional(),
    website: z
      .string()
      .url()
      .max(500)
      .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) link')
      .nullable()
      .optional(),
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^[0-9+()\-\s]{6,30}$/, 'Enter a valid phone number')
      .nullable()
      .optional(),
  })
  .strict();

const listQuery = z.object({
  status: z.enum(['draft', 'in_review', 'published', 'unpublished', 'removed']).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const appQuery = z.object({
  status: z.enum(SITE_STATUSES).optional(),
  opportunity_id: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const statusBody = z
  .object({
    status: z.enum(SITE_STATUSES).refine((s) => s !== 'withdrawn', 'You cannot withdraw'),
    note: z.string().trim().max(500).nullable().optional(),
    visible_to_applicant: z.boolean().default(true),
  })
  .strict();

const POSTS_PER_DAY = 15;

/** The employer (recruiter) API: their company, their own posts and the applications to them. */
export function registerEmployer(
  app: FastifyInstance,
  deps: { repo: EmployerRepo; applications: ApplicationRepo; clock: Clock; guard: GuardOptions },
): void {
  const { repo, applications, clock, guard } = deps;
  const heavy = new RateLimiter(LIMITS.search);
  const user = (req: FastifyRequest) => req.auth!.userId;
  const r = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    handler: Parameters<typeof route>[2]['handler'],
  ) => route(app, guard, { method, url, access: 'employer.manage', handler });

  const needProfile = async (req: FastifyRequest) => {
    const p = await repo.profile(user(req));
    if (!p) throw new AppError('FORBIDDEN', 'This account has no company set up.');
    return p;
  };

  r('GET', '/api/v1/employer/profile', async (req) => ({ data: await needProfile(req) }));

  r('PUT', '/api/v1/employer/profile', async (req) => {
    const b = companyBody.parse(readJson(req));
    await needProfile(req);
    await repo.updateProfile(user(req), {
      ...(b.company_name !== undefined ? { company_name: b.company_name } : {}),
      ...(b.website !== undefined ? { website: b.website } : {}),
      ...(b.phone !== undefined ? { phone: b.phone } : {}),
    });
    return { data: await repo.profile(user(req)) };
  });

  r('GET', '/api/v1/employer/overview', async (req) => {
    await needProfile(req);
    return { data: await repo.overview(user(req)) };
  });

  r('GET', '/api/v1/employer/opportunities', async (req) => {
    await needProfile(req);
    const q = listQuery.parse(req.query);
    const { items, total } = await repo.list(user(req), {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { q: q.q } : {}),
      limit: q.limit,
      offset: q.offset,
    });
    return { data: items, meta: { total, limit: q.limit, offset: q.offset } };
  });

  r('POST', '/api/v1/employer/opportunities', async (req, reply) => {
    await needProfile(req);
    const t = heavy.take(user(req), clock.now().getTime());
    if (!t.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Please wait.', undefined, {
        'retry-after': String(t.retryAfterSeconds),
      });
    }
    const day = new Date(clock.now().getTime() - 86_400_000);
    if ((await repo.createdSince(user(req), day)) >= POSTS_PER_DAY) {
      throw new AppError('RATE_LIMITED', `You can create up to ${POSTS_PER_DAY} posts a day.`);
    }
    const b = createBody.parse(readJson(req));
    const input = toInput({ ...b, organization_id: '0' } as never);
    const { organization_id: _ignored, ...rest } = input;
    const res = await repo.create(user(req), rest, req.id);
    if (res === 'bad_category') throw new AppError('VALIDATION_ERROR', 'Unknown category.');
    if (res === 'no_company')
      throw new AppError('FORBIDDEN', 'This account has no company set up.');
    return reply.status(201).send({ data: res });
  });

  r('GET', '/api/v1/employer/opportunities/:id', async (req) => {
    const o = await repo.get(user(req), bigintId((req.params as { id: string }).id));
    if (!o) throw new AppError('NOT_FOUND', 'Post not found.');
    return { data: o };
  });

  r('PATCH', '/api/v1/employer/opportunities/:id', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    const { updated_at, ...rest } = patchBody.parse(readJson(req));
    const input = toInput({ ...rest, organization_id: '0' } as never);
    const { organization_id: _ignored, ...patch } = input;
    const res = await repo.update(user(req), id, patch, updated_at, req.id);
    if (res === 'not_found') throw new AppError('NOT_FOUND', 'Post not found.');
    if (res === 'locked') {
      throw new AppError(
        'CONFLICT',
        'Close this live post first, then edit it and submit it again.',
      );
    }
    if (res === 'conflict') {
      throw new AppError('EDIT_CONFLICT', 'This post changed elsewhere. Reload and try again.');
    }
    if (res === 'bad_category') throw new AppError('VALIDATION_ERROR', 'Unknown category.');
    return { data: await repo.get(user(req), id) };
  });

  r('POST', '/api/v1/employer/opportunities/:id/submit', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    const res = await repo.submit(user(req), id, req.id);
    if (res === 'not_found') throw new AppError('NOT_FOUND', 'Post not found.');
    if (res === 'bad_state') throw new AppError('CONFLICT', 'Only a draft can be sent for review.');
    if (res === 'incomplete') {
      throw new AppError(
        'VALIDATION_ERROR',
        'Add a summary and a deadline before sending it for review.',
        [{ path: 'summary_en', code: 'required', message: 'Add a summary and a deadline first.' }],
      );
    }
    return { data: await repo.get(user(req), id) };
  });

  r('POST', '/api/v1/employer/opportunities/:id/close', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    const res = await repo.close(user(req), id, req.id);
    if (res === 'not_found') throw new AppError('NOT_FOUND', 'Post not found.');
    if (res === 'bad_state')
      throw new AppError('CONFLICT', 'Only a live or waiting post can be closed.');
    return { data: await repo.get(user(req), id) };
  });

  r('GET', '/api/v1/employer/applications', async (req) => {
    await needProfile(req);
    const q = appQuery.parse(req.query);
    const { items, total } = await applications.adminList({
      ...(q.status ? { status: q.status } : {}),
      ...(q.opportunity_id ? { opportunityId: q.opportunity_id } : {}),
      ...(q.q ? { q: q.q } : {}),
      ownerUserId: user(req),
      limit: q.limit,
      offset: q.offset,
    });
    return {
      data: items,
      meta: {
        total,
        limit: q.limit,
        offset: q.offset,
        counts: await applications.statusCounts(user(req)),
      },
    };
  });

  r('GET', '/api/v1/employer/applications/:id', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    if (!(await repo.ownsApplication(user(req), id)))
      throw new AppError('NOT_FOUND', 'Application not found.');
    const a = await applications.adminGet(id);
    if (!a) throw new AppError('NOT_FOUND', 'Application not found.');
    return { data: a };
  });

  r('POST', '/api/v1/employer/applications/:id/status', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    if (!(await repo.ownsApplication(user(req), id)))
      throw new AppError('NOT_FOUND', 'Application not found.');
    const b = statusBody.parse(readJson(req));
    const res = await applications.setStatus(
      id,
      b.status,
      b.note ?? null,
      b.visible_to_applicant,
      { id: user(req), role: 'employer' },
      clock.now(),
      req.id,
    );
    if (res.kind === 'not_found') throw new AppError('NOT_FOUND', 'Application not found.');
    if (res.kind === 'bad_transition') {
      throw new AppError(
        'CONFLICT',
        `An application that is "${res.from}" cannot be moved to "${b.status}".`,
      );
    }
    return { data: await applications.adminGet(id) };
  });

  r('PUT', '/api/v1/employer/applications/:id/note', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    if (!(await repo.ownsApplication(user(req), id)))
      throw new AppError('NOT_FOUND', 'Application not found.');
    const b = z
      .object({ note: z.string().trim().max(3000).nullable() })
      .strict()
      .parse(readJson(req));
    await applications.setAdminNote(id, b.note, { id: user(req), role: 'employer' }, req.id);
    return { data: await applications.adminGet(id) };
  });
}
