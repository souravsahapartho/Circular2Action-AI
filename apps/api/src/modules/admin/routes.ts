import { ROLES, type Role } from '@c2a/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { bigintId, readJson } from '../../platform/http';
import { route, type GuardOptions } from '../auth/guard';
import type { AdminOpportunityInput, AdminRepo } from './repo';

const RULE_TYPES = [
  'age',
  'education_level',
  'discipline',
  'result',
  'experience_years',
  'skill',
  'nationality',
  'district',
  'gender',
  'language_test',
  'passing_year',
  'custom',
] as const;

const httpUrl = z
  .string()
  .url()
  .max(1000)
  .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) link');
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real date');

/** A date-only deadline is stored as 23:59:59 in Dhaka (plan: deadline_precision date). */
const toDeadline = (d: string) => new Date(`${d}T17:59:59.000Z`);

const requirement = z
  .object({
    rule_type: z.enum(RULE_TYPES),
    necessity: z.enum(['mandatory', 'preferred', 'conditional']),
    params: z.record(z.unknown()),
    text: text(2000),
  })
  .strict();

const opportunityBody = z
  .object({
    title: z.string().trim().min(3).max(500),
    title_alt: text(500),
    organization_id: z.string().regex(/^\d{1,20}$/),
    category_slug: z.string().regex(/^[a-z0-9-]{1,100}$/),
    position_title: text(300),
    summary_bn: text(5000),
    summary_en: text(5000),
    vacancies: z.number().int().min(1).max(1_000_000).nullable().optional(),
    deadline_date: dateOnly.nullable().optional(),
    location_slug: z
      .string()
      .regex(/^[a-z0-9-]{1,120}$/)
      .nullable()
      .optional(),
    official_url: httpUrl.nullable().optional(),
    application_url: httpUrl.nullable().optional(),
    apply_mode: z.enum(['external', 'site', 'both']).optional(),
    how_to_apply: text(5000),
    required_documents: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(300),
          note: z.string().max(500).optional(),
        }),
      )
      .max(40)
      .nullable()
      .optional(),
    requirements: z.array(requirement).max(40).optional(),
  })
  .strict();

const patchBody = opportunityBody.partial().extend({ updated_at: z.string().datetime() }).strict();

const organizationBody = z
  .object({
    name_en: text(250),
    name_bn: text(250),
    type: z.enum([
      'government',
      'autonomous',
      'bank',
      'private',
      'ngo',
      'university',
      'international',
      'other',
    ]),
    website_url: httpUrl.nullable().optional(),
  })
  .strict()
  .refine((o) => Boolean(o.name_en) || Boolean(o.name_bn), 'At least one name is required');

const listQuery = z.object({
  status: z.enum(['draft', 'in_review', 'published', 'unpublished', 'removed']).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

function toInput(b: z.infer<typeof opportunityBody>): AdminOpportunityInput {
  const { deadline_date, ...rest } = b;
  return {
    ...rest,
    ...(deadline_date !== undefined
      ? { deadline_at: deadline_date ? toDeadline(deadline_date) : null }
      : {}),
  } as AdminOpportunityInput;
}

const actorOf = (req: FastifyRequest) => ({
  id: req.auth!.userId,
  role: req.auth!.roles.find((r) => r !== 'user') ?? 'user',
});

/** Staff API (plan 12.2 Admin). Every route needs a permission, and a staff session needs its second factor. */
export function registerAdmin(
  app: FastifyInstance,
  deps: { repo: AdminRepo; guard: GuardOptions; onPublished?: (id: string) => void },
): void {
  const { repo, guard } = deps;

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/overview',
    access: 'admin.view',
    handler: async () => ({ data: await repo.overview() }),
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/opportunities',
    access: 'opportunity.read',
    handler: async (req) => {
      const q = listQuery.parse(req.query);
      const { items, total } = await repo.list(q);
      return { data: items, meta: { total, limit: q.limit, offset: q.offset } };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/opportunities',
    access: 'opportunity.write',
    handler: async (req, reply) => {
      const b = opportunityBody.parse(readJson(req));
      const res = await repo.create(toInput(b), actorOf(req), req.id);
      if (res === 'bad_category') throw new AppError('VALIDATION_ERROR', 'Unknown category.');
      if (res === 'bad_organization')
        throw new AppError('VALIDATION_ERROR', 'Unknown organisation.');
      return reply.status(201).send({ data: res });
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/opportunities/:id',
    access: 'opportunity.read',
    handler: async (req) => {
      const o = await repo.get(bigintId((req.params as { id: string }).id));
      if (!o) throw new AppError('NOT_FOUND', 'Opportunity not found.');
      return { data: o };
    },
  });

  route(app, guard, {
    method: 'PATCH',
    url: '/api/v1/admin/opportunities/:id',
    access: 'opportunity.write',
    handler: async (req) => {
      const id = bigintId((req.params as { id: string }).id);
      const { updated_at, ...rest } = patchBody.parse(readJson(req));
      const res = await repo.update(
        id,
        toInput(rest as z.infer<typeof opportunityBody>),
        updated_at,
        actorOf(req),
        req.id,
      );
      if (res === 'not_found') throw new AppError('NOT_FOUND', 'Opportunity not found.');
      if (res === 'conflict') {
        throw new AppError(
          'EDIT_CONFLICT',
          'Someone else changed this opportunity. Reload and try again.',
        );
      }
      if (res === 'bad_category') throw new AppError('VALIDATION_ERROR', 'Unknown category.');
      return { data: await repo.get(id) };
    },
  });

  const publication = (action: 'publish' | 'unpublish' | 'remove') =>
    route(app, guard, {
      method: 'POST',
      url: `/api/v1/admin/opportunities/:id/${action}`,
      access: action === 'remove' ? 'opportunity.remove' : 'opportunity.publish',
      handler: async (req) => {
        const id = bigintId((req.params as { id: string }).id);
        const { reason } = z
          .object({ reason: z.string().trim().max(500).optional() })
          .strict()
          .parse(readJson(req));
        const to =
          action === 'publish' ? 'published' : action === 'unpublish' ? 'unpublished' : 'removed';
        const res = await repo.setPublication(id, to, actorOf(req), req.id, reason);
        if (res === 'not_found') throw new AppError('NOT_FOUND', 'Opportunity not found.');
        if (res === 'needs_official_url') {
          throw new AppError(
            'VALIDATION_ERROR',
            'Add the link to the official circular before publishing.',
            [
              {
                path: 'official_url',
                code: 'required',
                message: 'Official circular link is required to publish.',
              },
            ],
          );
        }
        if (action === 'publish') deps.onPublished?.(id);
        return { data: await repo.get(id) };
      },
    });
  publication('publish');
  publication('unpublish');
  publication('remove');

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/organizations',
    access: 'organization.manage',
    handler: async (req) => {
      const { q } = z.object({ q: z.string().trim().max(200).optional() }).parse(req.query);
      return { data: await repo.listOrganizations(q) };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/organizations',
    access: 'organization.manage',
    handler: async (req, reply) => {
      const b = organizationBody.parse(readJson(req));
      const res = await repo.createOrganization(b);
      if (res === 'exists')
        throw new AppError('ALREADY_EXISTS', 'An organisation with this name already exists.');
      await repo.audit(null, {
        actorId: req.auth!.userId,
        actorRole: actorOf(req).role,
        action: 'organization.create',
        targetType: 'organization',
        targetId: res.id,
        requestId: req.id,
      });
      return reply.status(201).send({ data: res });
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/users',
    access: 'user.read',
    handler: async (req) => {
      const q = z
        .object({
          q: z.string().trim().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      return { data: await repo.listUsers(q.q, q.limit, q.offset) };
    },
  });

  route(app, guard, {
    method: 'PUT',
    url: '/api/v1/admin/users/:id/roles',
    access: 'user.manage_roles',
    handler: async (req, reply) => {
      const id = bigintId((req.params as { id: string }).id);
      const b = z
        .object({ roles: z.array(z.enum(ROLES as unknown as [Role, ...Role[]])).max(8) })
        .strict()
        .parse(readJson(req));
      if (id === req.auth!.userId && !b.roles.includes('super_admin')) {
        throw new AppError('FORBIDDEN', 'You cannot remove your own super admin role.');
      }
      if (!(await repo.setRoles(id, b.roles, actorOf(req), req.id))) {
        throw new AppError('NOT_FOUND', 'User not found.');
      }
      return reply.status(204).send();
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/audit-logs',
    access: 'audit.view',
    handler: async (req) => {
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      return { data: await repo.auditLogs(q.limit, q.offset) };
    },
  });
}
