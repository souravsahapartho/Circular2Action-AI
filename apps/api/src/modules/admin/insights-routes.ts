import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { bigintId, readJson } from '../../platform/http';
import { route, type GuardOptions } from '../auth/guard';
import { SITE_STATUSES } from '../applications/logic';
import type { ApplicationRepo } from '../applications/repo';
import { toCsv, type AdminInsights } from './insights';

const actorOf = (req: FastifyRequest) => ({
  id: req.auth!.userId,
  role: req.auth!.roles.find((r) => r !== 'user') ?? 'user',
});

const bulkBody = z
  .object({
    ids: z
      .array(z.string().regex(/^\d{1,20}$/))
      .min(1)
      .max(100),
    status: z.enum(SITE_STATUSES).refine((s) => s !== 'withdrawn', 'Staff cannot withdraw'),
    note: z.string().trim().max(500).nullable().optional(),
    visible_to_applicant: z.boolean().default(true),
  })
  .strict();

const exportQuery = z.object({
  status: z.enum(SITE_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
});

/** Extra staff tools: analytics, CSV export, bulk status, suspend, broadcast (plan v1.3). */
export function registerAdminInsights(
  app: FastifyInstance,
  deps: {
    insights: AdminInsights;
    applications: ApplicationRepo;
    now: () => Date;
    guard: GuardOptions;
    /** Called after people were notified, so a push can go out at once. */
    afterNotify?: () => void;
  },
): void {
  const { insights, applications, guard, now } = deps;

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/analytics',
    access: 'analytics.view',
    handler: async () => ({ data: await insights.analytics() }),
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/applications/export',
    access: 'application.read',
    handler: async (req, reply) => {
      const q = exportQuery.parse(req.query);
      const rows = await insights.exportApplications({
        ...(q.status ? { status: q.status } : {}),
        ...(q.q ? { q: q.q } : {}),
      });
      const csv = toCsv(
        [
          'tracking_code',
          'status',
          'submitted_at',
          'applicant_name',
          'applicant_email',
          'applicant_phone',
          'eligibility',
          'opportunity',
          'organization',
        ],
        rows.map((r) => [
          r.tracking_code,
          r.status,
          r.submitted_at,
          r.applicant_name,
          r.applicant_email,
          r.applicant_phone,
          r.eligibility_status,
          r.opportunity,
          r.organization,
        ]),
      );
      const a = actorOf(req);
      await applications.auditExport(a, rows.length, req.id);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="applications-${now().toISOString().slice(0, 10)}.csv"`,
        )
        .header('cache-control', 'no-store')
        .send('﻿' + csv);
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/applications/bulk-status',
    access: 'application.manage',
    handler: async (req) => {
      const b = bulkBody.parse(readJson(req));
      const done: string[] = [];
      const skipped: Array<{ id: string; reason: string }> = [];
      for (const id of [...new Set(b.ids)]) {
        const res = await applications.setStatus(
          id,
          b.status,
          b.note ?? null,
          b.visible_to_applicant,
          actorOf(req),
          now(),
          req.id,
        );
        if (res.kind === 'ok') done.push(id);
        else
          skipped.push({ id, reason: res.kind === 'not_found' ? 'not found' : `is ${res.from}` });
      }
      return { data: { updated: done.length, skipped } };
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/users/:id/status',
    access: 'user.moderate',
    handler: async (req, reply) => {
      const id = bigintId((req.params as { id: string }).id);
      const b = z
        .object({
          status: z.enum(['active', 'suspended']),
          reason: z.string().trim().max(500).nullable().optional(),
        })
        .strict()
        .parse(readJson(req));
      if (id === req.auth!.userId)
        throw new AppError('FORBIDDEN', 'You cannot change your own status.');
      const res = await insights.setUserStatus(
        id,
        b.status,
        actorOf(req),
        b.reason ?? null,
        req.id,
      );
      if (res === 'not_found') throw new AppError('NOT_FOUND', 'User not found.');
      if (res === 'pending_deletion') {
        throw new AppError(
          'CONFLICT',
          'This account is waiting for deletion and cannot be changed.',
        );
      }
      return reply.status(204).send();
    },
  });

  route(app, guard, {
    method: 'POST',
    url: '/api/v1/admin/notifications/broadcast',
    access: 'system.operate',
    handler: async (req) => {
      const b = z
        .object({
          title: z.string().trim().min(3).max(120),
          message: z.string().trim().min(3).max(500),
          audience: z.enum(['all', 'seekers', 'employers', 'category', 'user']),
          email: z.string().trim().toLowerCase().email().max(254).optional(),
          category_slug: z
            .string()
            .regex(/^[a-z0-9-]{1,100}$/)
            .optional(),
        })
        .strict()
        .refine((v) => v.audience !== 'category' || Boolean(v.category_slug), 'Choose a category')
        .refine((v) => v.audience !== 'user' || Boolean(v.email), 'Enter the email address')
        .parse(readJson(req));
      const told = await insights.broadcast(
        {
          title: b.title,
          message: b.message,
          audience: b.audience,
          ...(b.category_slug ? { categorySlug: b.category_slug } : {}),
          ...(b.email ? { email: b.email } : {}),
        },
        actorOf(req),
        req.id,
      );
      deps.afterNotify?.();
      return { data: { told } };
    },
  });

  route(app, guard, {
    method: 'GET',
    url: '/api/v1/admin/notifications/history',
    access: 'system.operate',
    handler: async () => ({ data: await insights.broadcastHistory(30) }),
  });
}
