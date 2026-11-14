import { evaluate, type Requirement } from '@c2a/eligibility';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../platform/clock';
import { AppError } from '../../platform/errors';
import { bigintId, readJson } from '../../platform/http';
import { LIMITS, RateLimiter } from '../../platform/rate-limit';
import { route, type GuardOptions } from '../auth/guard';
import type { MeRepo } from '../me/repo';
import type { OpportunityRepo } from '../opportunities/repo';
import { normalizeTrackingCode, SITE_STATUSES } from './logic';
import type { ApplicationRepo } from './repo';

const applyBody = z
  .object({
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^[0-9+()\-\s]{6,30}$/, 'Enter a valid phone number')
      .nullable()
      .optional(),
    cover_note: z.string().trim().max(3000).nullable().optional(),
    consent: z.literal(true, {
      errorMap: () => ({ message: 'Consent is required to share your profile with the staff.' }),
    }),
  })
  .strict();

const staffStatusBody = z
  .object({
    status: z.enum(SITE_STATUSES).refine((s) => s !== 'withdrawn', 'Staff cannot withdraw'),
    note: z.string().trim().max(500).nullable().optional(),
    visible_to_applicant: z.boolean().default(true),
  })
  .strict();

const noteBody = z.object({ note: z.string().trim().max(3000).nullable() }).strict();

const adminQuery = z.object({
  status: z.enum(SITE_STATUSES).optional(),
  opportunity_id: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const actorOf = (req: FastifyRequest) => ({
  id: req.auth!.userId,
  role: req.auth!.roles.find((r) => r !== 'user') ?? 'user',
});

/** Applications made through the site: apply, follow with a tracking ID, and staff handling (plan v1.2). */
export function registerApplications(
  app: FastifyInstance,
  deps: {
    repo: ApplicationRepo;
    me: MeRepo;
    opportunities: OpportunityRepo;
    clock: Clock;
    guard: GuardOptions;
  },
): void {
  const { repo, me, opportunities, clock, guard } = deps;
  const trackByIp = new RateLimiter({ capacity: 20, refillPerSecond: 20 / 60 });
  const applyByUser = new RateLimiter(LIMITS.register);
  const user = (
    method: 'GET' | 'POST',
    url: string,
    handler: Parameters<typeof route>[2]['handler'],
  ) => route(app, guard, { method, url, access: 'authenticated', handler });

  user('POST', '/api/v1/opportunities/:id/apply', async (req, reply) => {
    const id = bigintId((req.params as { id: string }).id);
    const r = applyByUser.take(`${req.auth!.userId}`, clock.now().getTime());
    if (!r.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many applications. Please wait.', undefined, {
        'retry-after': String(r.retryAfterSeconds),
      });
    }
    const b = applyBody.parse(readJson(req));
    const o = await opportunities.get(id, 'en', clock.now());
    if (!o) throw new AppError('NOT_FOUND', 'Opportunity not found.');

    // a snapshot of the applicant's profile and eligibility, so staff review what the applicant saw
    const [profile, education] = await Promise.all([
      me.getProfile(req.auth!.userId),
      me.listEducation(req.auth!.userId),
    ]);
    const reqs: Requirement[] = (o.requirements ?? []).map((q) => ({
      id: q.id,
      ruleType: q.rule_type as Requirement['ruleType'],
      necessity: q.necessity as Requirement['necessity'],
      groupKey: q.group_key,
      branchKey: q.branch_key,
      params: q.params,
      machineEvaluable: q.machine_evaluable,
      verified: q.verified,
      ...(q.text ? { sourceText: q.text } : {}),
    }));
    const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(clock.now());
    const result = evaluate(await me.eligibilityProfile(req.auth!.userId), reqs, asOf);

    const res = await repo.apply(
      req.auth!.userId,
      id,
      {
        phone: b.phone ?? null,
        cover_note: b.cover_note ?? null,
        eligibility_status: result.status,
        snapshot: {
          date_of_birth: profile.date_of_birth,
          gender: profile.gender,
          headline: profile.headline ?? null,
          education: education.map((e) => ({
            level: e.level,
            status: e.status,
            institution: e.institution_other ?? null,
            discipline: e.discipline_other ?? null,
            passing_year: e.passing_year,
            result_scale: e.result_scale,
            result_value: e.result_value,
          })),
          eligibility: { status: result.status, summary: result.summary },
        },
      },
      clock.now(),
    );
    switch (res.kind) {
      case 'not_found':
        throw new AppError('NOT_FOUND', 'Opportunity not found.');
      case 'not_open':
        throw new AppError('CONFLICT', 'Applications for this opportunity are closed.');
      case 'not_accepting':
        throw new AppError('CONFLICT', 'This opportunity does not take applications on this site.');
      case 'no_user':
        throw new AppError('FORBIDDEN', 'This account cannot apply.');
      default:
        return reply.status(res.kind === 'created' ? 201 : 200).send({
          data: {
            id: res.id,
            tracking_code: res.tracking_code,
            status: res.status,
            existing: res.kind === 'existing',
          },
        });
    }
  });

  user('GET', '/api/v1/me/site-applications', async (req) => ({
    data: await repo.listForUser(req.auth!.userId),
  }));

  user('GET', '/api/v1/me/site-applications/:id', async (req) => {
    const a = await repo.getForUser(req.auth!.userId, bigintId((req.params as { id: string }).id));
    if (!a) throw new AppError('NOT_FOUND', 'Application not found.');
    return { data: a };
  });

  user('POST', '/api/v1/me/site-applications/:id/withdraw', async (req) => {
    const res = await repo.withdraw(
      req.auth!.userId,
      bigintId((req.params as { id: string }).id),
      clock.now(),
    );
    if (res === 'not_found') throw new AppError('NOT_FOUND', 'Application not found.');
    if (res === 'closed') throw new AppError('CONFLICT', 'This application is already closed.');
    return { data: { status: 'withdrawn' } };
  });

  // public: the tracking code is the credential; the answer carries no personal data
  route(app, guard, {
    method: 'GET',
    url: '/api/v1/track/:code',
    access: 'public',
    handler: async (req) => {
      const r = trackByIp.take(req.ip, clock.now().getTime());
      if (!r.allowed) {
        throw new AppError('RATE_LIMITED', 'Too many lookups. Please wait.', undefined, {
          'retry-after': String(r.retryAfterSeconds),
        });
      }
      const code = normalizeTrackingCode((req.params as { code: string }).code);
      const found = code ? await repo.track(code) : null;
      if (!found) throw new AppError('NOT_FOUND', 'No application matches this tracking ID.');
      return { data: found };
    },
  });

  // staff
  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/applications',
    access: 'application.read',
    handler: async (req) => {
      const q = adminQuery.parse(req.query);
      const { items, total } = await repo.adminList({
        ...(q.status ? { status: q.status } : {}),
        ...(q.opportunity_id ? { opportunityId: q.opportunity_id } : {}),
        ...(q.q ? { q: q.q } : {}),
        limit: q.limit,
        offset: q.offset,
      });
      return {
        data: items,
        meta: { total, limit: q.limit, offset: q.offset, counts: await repo.statusCounts() },
      };
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/applications/:id',
    access: 'application.read',
    handler: async (req) => {
      const a = await repo.adminGet(bigintId((req.params as { id: string }).id));
      if (!a) throw new AppError('NOT_FOUND', 'Application not found.');
      return { data: a };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/applications/:id/status',
    access: 'application.manage',
    handler: async (req) => {
      const id = bigintId((req.params as { id: string }).id);
      const b = staffStatusBody.parse(readJson(req));
      const res = await repo.setStatus(
        id,
        b.status,
        b.note ?? null,
        b.visible_to_applicant,
        actorOf(req),
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
      return { data: await repo.adminGet(id) };
    },
  });

  route(app, guard, {
    method: 'PUT',
    url: '/api/v1/admin/applications/:id/note',
    access: 'application.manage',
    handler: async (req) => {
      const id = bigintId((req.params as { id: string }).id);
      const b = noteBody.parse(readJson(req));
      if (!(await repo.setAdminNote(id, b.note, actorOf(req), req.id))) {
        throw new AppError('NOT_FOUND', 'Application not found.');
      }
      return { data: await repo.adminGet(id) };
    },
  });
}
