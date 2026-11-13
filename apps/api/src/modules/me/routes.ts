import { evaluate, type Requirement } from '@c2a/eligibility';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../../platform/clock';
import { AppError } from '../../platform/errors';
import { bigintId, readJson } from '../../platform/http';
import { route, type GuardOptions } from '../auth/guard';
import type { OpportunityRepo } from '../opportunities/repo';
import { APPLICATION_STATUSES, type MeRepo } from './repo';

const LEVELS = ['ssc', 'hsc', 'diploma', 'bachelor', 'masters', 'mphil', 'phd', 'other'] as const;
const thisYear = 2100;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real date');
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

const profileBody = z
  .object({
    date_of_birth: isoDate.nullable().optional(),
    gender: z.enum(['female', 'male', 'other']).nullable().optional(),
    nationality_country: z.string().length(2).toUpperCase().optional(),
    home_district_id: z
      .string()
      .regex(/^\d{1,20}$/)
      .nullable()
      .optional(),
    current_district_id: z
      .string()
      .regex(/^\d{1,20}$/)
      .nullable()
      .optional(),
    headline: optText(160),
    preferences: z
      .object({
        categories: z.array(z.string().max(100)).max(20).optional(),
        location_ids: z
          .array(z.string().regex(/^\d{1,20}$/))
          .max(20)
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const educationBody = z
  .object({
    level: z.enum(LEVELS),
    institution_other: optText(200),
    discipline_other: optText(200),
    degree_title: optText(200),
    result_scale: z.enum(['gpa4', 'gpa5', 'percent', 'class']).nullable().optional(),
    result_value: z.number().min(0).max(100).nullable().optional(),
    result_class: z.enum(['first', 'second', 'third']).nullable().optional(),
    status: z.enum(['completed', 'in_progress', 'appeared']).default('completed'),
    start_year: z.number().int().min(1950).max(thisYear).nullable().optional(),
    passing_year: z.number().int().min(1950).max(thisYear).nullable().optional(),
  })
  .strict()
  .refine(
    (e) => e.result_scale !== 'gpa4' || e.result_value == null || e.result_value <= 4,
    'CGPA out of 4 cannot exceed 4',
  )
  .refine(
    (e) => e.result_scale !== 'gpa5' || e.result_value == null || e.result_value <= 5,
    'CGPA out of 5 cannot exceed 5',
  );

const createApplicationBody = z.union([
  z.object({ opportunity_id: z.string().regex(/^\d{1,20}$/) }).strict(),
  z
    .object({
      title: z.string().trim().min(1).max(300),
      organization: z.string().trim().max(250).optional(),
      // only http(s): a `javascript:` link would run script when shown as a link
      url: z
        .string()
        .url()
        .max(1000)
        .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) link')
        .optional(),
      deadline_at: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
]);

const patchApplicationBody = z
  .object({
    applied_at: isoDate.nullable().optional(),
    exam_at: z.string().datetime({ offset: true }).nullable().optional(),
    interview_at: z.string().datetime({ offset: true }).nullable().optional(),
    follow_up_at: z.string().datetime({ offset: true }).nullable().optional(),
    payment_status: z.enum(['not_required', 'unpaid', 'paid']).nullable().optional(),
    amount_paid: z.number().min(0).max(100_000_000).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();

const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(v);

/** Profile, saved opportunities, tracker and eligibility for the signed-in user (plan Modules C, G). */
export function registerMe(
  app: FastifyInstance,
  deps: { repo: MeRepo; opportunities: OpportunityRepo; clock: Clock; guard: GuardOptions },
): void {
  const { repo, opportunities, clock, guard } = deps;
  const r = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    handler: Parameters<typeof route>[2]['handler'],
  ) => route(app, guard, { method, url, access: 'authenticated', handler });

  // ---- profile ----
  r('GET', '/api/v1/me/profile', async (req) => {
    const uid = req.auth!.userId;
    const [profile, education] = await Promise.all([repo.getProfile(uid), repo.listEducation(uid)]);
    const checks = [
      profile.date_of_birth,
      profile.gender,
      education.length > 0,
      profile.home_district_id,
    ];
    return {
      data: {
        profile,
        education,
        completeness: Math.round((checks.filter(Boolean).length / checks.length) * 100),
      },
    };
  });

  r('PUT', '/api/v1/me/profile', async (req) => {
    const b = profileBody.parse(readJson(req));
    if (b.date_of_birth && Date.parse(`${b.date_of_birth}T00:00:00Z`) > clock.now().getTime()) {
      throw new AppError('VALIDATION_ERROR', 'Date of birth cannot be in the future.', [
        {
          path: 'date_of_birth',
          code: 'future',
          message: 'Date of birth cannot be in the future.',
        },
      ]);
    }
    const patch = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    await repo.saveProfile(req.auth!.userId, patch);
    return { data: { profile: await repo.getProfile(req.auth!.userId) } };
  });

  r('POST', '/api/v1/me/education', async (req, reply) => {
    const id = await repo.addEducation(req.auth!.userId, educationBody.parse(readJson(req)));
    return reply.status(201).send({ data: { id } });
  });
  r('PATCH', '/api/v1/me/education/:id', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    if (!(await repo.updateEducation(req.auth!.userId, id, educationBody.parse(readJson(req))))) {
      throw new AppError('NOT_FOUND', 'Education record not found.');
    }
    return { data: { id } };
  });
  r('DELETE', '/api/v1/me/education/:id', async (req, reply) => {
    const id = bigintId((req.params as { id: string }).id);
    if (!(await repo.deleteEducation(req.auth!.userId, id))) {
      throw new AppError('NOT_FOUND', 'Education record not found.');
    }
    return reply.status(204).send();
  });

  // ---- saved ----
  r('GET', '/api/v1/me/saved', async (req) => {
    const locale = z
      .enum(['bn', 'en'])
      .default('bn')
      .parse((req.query as { locale?: string }).locale);
    const ids = await repo.savedIds(req.auth!.userId);
    return { data: await opportunities.summaries(ids, locale, clock.now()) };
  });
  r('PUT', '/api/v1/me/saved/:opportunityId', async (req, reply) => {
    const id = bigintId((req.params as { opportunityId: string }).opportunityId);
    if (!(await repo.save(req.auth!.userId, id)))
      throw new AppError('NOT_FOUND', 'Opportunity not found.');
    return reply.status(204).send();
  });
  r('DELETE', '/api/v1/me/saved/:opportunityId', async (req, reply) => {
    await repo.unsave(
      req.auth!.userId,
      bigintId((req.params as { opportunityId: string }).opportunityId),
    );
    return reply.status(204).send();
  });
  r('GET', '/api/v1/me/saved-ids', async (req) => ({
    data: await repo.savedIds(req.auth!.userId),
  }));

  // ---- eligibility from the saved profile ----
  r('POST', '/api/v1/opportunities/:id/eligibility', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    const o = await opportunities.get(id, 'en', clock.now());
    if (!o) throw new AppError('NOT_FOUND', 'Opportunity not found.');
    const profile = await repo.eligibilityProfile(req.auth!.userId);
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
    return { data: evaluate(profile, reqs, asOf) };
  });

  // ---- tracker ----
  r('GET', '/api/v1/me/applications', async (req) => {
    const status = z
      .enum(APPLICATION_STATUSES)
      .optional()
      .parse((req.query as { status?: string }).status);
    return { data: await repo.listApplications(req.auth!.userId, status) };
  });
  r('GET', '/api/v1/me/applications/stats', async (req) => ({
    data: await repo.applicationStats(req.auth!.userId),
  }));
  r('POST', '/api/v1/me/applications', async (req, reply) => {
    const b = createApplicationBody.parse(readJson(req));
    const created =
      'opportunity_id' in b
        ? await repo.createApplication(req.auth!.userId, { opportunityId: b.opportunity_id })
        : await repo.createApplication(req.auth!.userId, {
            title: b.title,
            ...(b.organization ? { organization: b.organization } : {}),
            ...(b.url ? { url: b.url } : {}),
            ...(b.deadline_at ? { deadlineAt: new Date(b.deadline_at) } : {}),
          });
    if (created === 'not_found') throw new AppError('NOT_FOUND', 'Opportunity not found.');
    if (created === 'exists')
      throw new AppError('ALREADY_EXISTS', 'You are already tracking this opportunity.');
    return reply.status(201).send({ data: created });
  });
  r('GET', '/api/v1/me/applications/:id', async (req) => {
    const a = await repo.getApplication(
      req.auth!.userId,
      bigintId((req.params as { id: string }).id),
    );
    if (!a) throw new AppError('NOT_FOUND', 'Application not found.');
    return { data: a };
  });
  r('PATCH', '/api/v1/me/applications/:id', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    const b = patchApplicationBody.parse(readJson(req));
    const ok = await repo.updateApplication(req.auth!.userId, id, {
      ...(b.applied_at !== undefined ? { applied_at: b.applied_at } : {}),
      ...(b.exam_at !== undefined ? { exam_at: toDate(b.exam_at) ?? null } : {}),
      ...(b.interview_at !== undefined ? { interview_at: toDate(b.interview_at) ?? null } : {}),
      ...(b.follow_up_at !== undefined ? { follow_up_at: toDate(b.follow_up_at) ?? null } : {}),
      ...(b.payment_status !== undefined ? { payment_status: b.payment_status } : {}),
      ...(b.amount_paid !== undefined ? { amount_paid: b.amount_paid } : {}),
      ...(b.notes !== undefined ? { notes: b.notes } : {}),
    });
    if (!ok) throw new AppError('NOT_FOUND', 'Application not found.');
    return { data: await repo.getApplication(req.auth!.userId, id) };
  });
  r('POST', '/api/v1/me/applications/:id/status', async (req) => {
    const id = bigintId((req.params as { id: string }).id);
    const b = z
      .object({
        to_status: z.enum(APPLICATION_STATUSES),
        note: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(readJson(req));
    if (!(await repo.setStatus(req.auth!.userId, id, b.to_status, b.note))) {
      throw new AppError('NOT_FOUND', 'Application not found.');
    }
    return { data: await repo.getApplication(req.auth!.userId, id) };
  });
  r('DELETE', '/api/v1/me/applications/:id', async (req, reply) => {
    if (
      !(await repo.deleteApplication(req.auth!.userId, bigintId((req.params as { id: string }).id)))
    ) {
      throw new AppError('NOT_FOUND', 'Application not found.');
    }
    return reply.status(204).send();
  });
  r('POST', '/api/v1/me/applications/:id/checklist', async (req, reply) => {
    const id = bigintId((req.params as { id: string }).id);
    const { label } = z
      .object({ label: z.string().trim().min(1).max(300) })
      .strict()
      .parse(readJson(req));
    const item = await repo.addChecklistItem(req.auth!.userId, id, label);
    if (!item) throw new AppError('NOT_FOUND', 'Application not found.');
    return reply.status(201).send({ data: { id: item } });
  });
  r('PATCH', '/api/v1/me/applications/:id/checklist/:itemId', async (req) => {
    const p = req.params as { id: string; itemId: string };
    const b = z
      .object({ done: z.boolean().optional(), label: z.string().trim().min(1).max(300).optional() })
      .strict()
      .parse(readJson(req));
    if (
      !(await repo.updateChecklistItem(req.auth!.userId, bigintId(p.id), bigintId(p.itemId), b))
    ) {
      throw new AppError('NOT_FOUND', 'Checklist item not found.');
    }
    return { data: { ok: true } };
  });
  r('DELETE', '/api/v1/me/applications/:id/checklist/:itemId', async (req, reply) => {
    const p = req.params as { id: string; itemId: string };
    if (!(await repo.deleteChecklistItem(req.auth!.userId, bigintId(p.id), bigintId(p.itemId)))) {
      throw new AppError('NOT_FOUND', 'Checklist item not found.');
    }
    return reply.status(204).send();
  });
}
