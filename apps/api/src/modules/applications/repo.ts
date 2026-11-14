import { createHash } from 'node:crypto';
import type { Db, Executor, Row } from '../../db/pool';
import {
  applicantCanWithdraw,
  newTrackingCode,
  SITE_STATUSES,
  staffCanMove,
  type SiteStatus,
} from './logic';

export interface ApplyInput {
  phone?: string | null;
  cover_note?: string | null;
  eligibility_status?: string | null;
  snapshot?: Record<string, unknown> | null;
}

export type ApplyResult =
  | { kind: 'created' | 'existing'; id: string; tracking_code: string; status: SiteStatus }
  | { kind: 'not_found' | 'not_open' | 'not_accepting' | 'no_user' };

export interface TimelineEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  at: string;
  by_staff?: boolean;
  public?: boolean;
}

interface AppRow extends Row {
  id: string;
  tracking_code: string;
  opportunity_id: string;
  user_id: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  cover_note: string | null;
  profile_snapshot: unknown;
  eligibility_status: string | null;
  status: string;
  admin_note: string | null;
  submitted_at: Date;
  updated_at: Date;
  title: string;
  title_alt: string | null;
  slug: string;
  org_en: string | null;
  org_bn: string | null;
}

const SELECT = `
  SELECT a.id, a.tracking_code, a.opportunity_id, a.user_id, a.applicant_name, a.applicant_email, a.applicant_phone,
         a.cover_note, a.profile_snapshot, a.eligibility_status, a.status, a.admin_note, a.submitted_at, a.updated_at,
         o.title, o.title_alt, o.slug, org.name_en AS org_en, org.name_bn AS org_bn
  FROM site_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  JOIN organizations org ON org.id = o.organization_id`;

const parseJson = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);

function summary(r: AppRow) {
  return {
    id: String(r.id),
    tracking_code: r.tracking_code,
    status: r.status as SiteStatus,
    submitted_at: r.submitted_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    opportunity: {
      id: String(r.opportunity_id),
      slug: r.slug,
      title: r.title,
      title_alt: r.title_alt,
      organization: r.org_en ?? r.org_bn ?? '',
      organization_bn: r.org_bn ?? r.org_en ?? '',
    },
  };
}

export type StaffStatusResult =
  | { kind: 'ok'; status: SiteStatus }
  | { kind: 'not_found' }
  | { kind: 'bad_transition'; from: SiteStatus };

/** Applications made through the site, the applicant's view, the public tracking view and the staff view. */
export class ApplicationRepo {
  constructor(private readonly db: Db) {}

  private async audit(
    tx: Executor,
    e: {
      actorId: string;
      actorRole: string;
      action: string;
      targetId: string;
      metadata?: Record<string, unknown>;
      requestId?: string;
    },
  ): Promise<void> {
    await tx.execute(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, request_id)
       VALUES (:a, :r, :act, 'site_application', :ti, :meta, :req)`,
      {
        a: e.actorId,
        r: e.actorRole.slice(0, 32),
        act: e.action,
        ti: e.targetId,
        meta: e.metadata ? JSON.stringify(e.metadata) : null,
        req: e.requestId?.slice(0, 40) ?? null,
      },
    );
  }

  // ---- applicant ----

  async apply(
    userId: string,
    opportunityId: string,
    input: ApplyInput,
    now: Date,
  ): Promise<ApplyResult> {
    const [opp] = await this.db.query<
      Row & { apply_mode: string; deadline_at: Date | null; lifecycle_status: string }
    >(
      `SELECT apply_mode, deadline_at, lifecycle_status FROM opportunities
       WHERE id = :id AND publication_status = 'published'`,
      { id: opportunityId },
    );
    if (!opp) return { kind: 'not_found' };
    if (opp.lifecycle_status !== 'open' || (opp.deadline_at && opp.deadline_at <= now)) {
      return { kind: 'not_open' };
    }
    if (opp.apply_mode !== 'site' && opp.apply_mode !== 'both') return { kind: 'not_accepting' };
    const [user] = await this.db.query<Row & { email: string; display_name: string }>(
      "SELECT email, display_name FROM users WHERE id = :id AND status = 'active'",
      { id: userId },
    );
    if (!user) return { kind: 'no_user' };

    const [existing] = await this.db.query<
      Row & { id: string; tracking_code: string; status: string }
    >(
      'SELECT id, tracking_code, status FROM site_applications WHERE user_id = :u AND opportunity_id = :o',
      { u: userId, o: opportunityId },
    );
    if (existing) {
      return {
        kind: 'existing',
        id: String(existing.id),
        tracking_code: existing.tracking_code,
        status: existing.status as SiteStatus,
      };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newTrackingCode();
      try {
        const id = await this.db.transaction(async (tx) => {
          const res = await tx.execute(
            `INSERT INTO site_applications (tracking_code, opportunity_id, user_id, applicant_name, applicant_email,
               applicant_phone, cover_note, profile_snapshot, eligibility_status, status, submitted_at)
             VALUES (:code, :o, :u, :name, :email, :phone, :note, :snap, :elig, 'submitted', :now)`,
            {
              code,
              o: opportunityId,
              u: userId,
              name: user.display_name,
              email: user.email,
              phone: input.phone ?? null,
              note: input.cover_note ?? null,
              snap: input.snapshot ? JSON.stringify(input.snapshot) : null,
              elig: input.eligibility_status ?? null,
              now,
            },
          );
          const appId = String(res.insertId);
          await tx.execute(
            `INSERT INTO site_application_events (application_id, from_status, to_status, note, public, created_at)
             VALUES (:a, NULL, 'submitted', 'Application received.', 1, :now)`,
            { a: appId, now },
          );
          return appId;
        });
        return { kind: 'created', id, tracking_code: code, status: 'submitted' };
      } catch (err) {
        const dup = /Duplicate entry/i.test(err instanceof Error ? err.message : '');
        if (!dup) throw err;
        // either the code collided (retry with a new one) or the user raced themselves (return theirs)
        const [again] = await this.db.query<
          Row & { id: string; tracking_code: string; status: string }
        >(
          'SELECT id, tracking_code, status FROM site_applications WHERE user_id = :u AND opportunity_id = :o',
          { u: userId, o: opportunityId },
        );
        if (again) {
          return {
            kind: 'existing',
            id: String(again.id),
            tracking_code: again.tracking_code,
            status: again.status as SiteStatus,
          };
        }
      }
    }
    throw new Error('Could not allocate a tracking code');
  }

  private async events(applicationId: string, publicOnly: boolean): Promise<TimelineEvent[]> {
    const rows = await this.db.query<
      Row & {
        id: string;
        from_status: string | null;
        to_status: string;
        note: string | null;
        created_at: Date;
        actor_user_id: string | null;
        public: number;
      }
    >(
      `SELECT id, from_status, to_status, note, created_at, actor_user_id, public FROM site_application_events
       WHERE application_id = :a ${publicOnly ? 'AND public = 1' : ''} ORDER BY created_at, id`,
      { a: applicationId },
    );
    return rows.map((e) => ({
      id: String(e.id),
      from_status: e.from_status,
      to_status: e.to_status,
      note: e.note,
      at: e.created_at.toISOString(),
      ...(publicOnly ? {} : { by_staff: e.actor_user_id !== null, public: Number(e.public) === 1 }),
    }));
  }

  async listForUser(userId: string) {
    const rows = await this.db.query<AppRow>(
      `${SELECT} WHERE a.user_id = :u ORDER BY a.submitted_at DESC, a.id DESC`,
      { u: userId },
    );
    return rows.map(summary);
  }

  async getForUser(userId: string, id: string) {
    const [r] = await this.db.query<AppRow>(`${SELECT} WHERE a.id = :id AND a.user_id = :u`, {
      id,
      u: userId,
    });
    if (!r) return null;
    return {
      ...summary(r),
      applicant_phone: r.applicant_phone,
      cover_note: r.cover_note,
      eligibility_status: r.eligibility_status,
      timeline: await this.events(String(r.id), true),
    };
  }

  async withdraw(userId: string, id: string, now: Date): Promise<'ok' | 'not_found' | 'closed'> {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.query<Row & { status: string }>(
        'SELECT status FROM site_applications WHERE id = :id AND user_id = :u FOR UPDATE',
        { id, u: userId },
      );
      if (!r) return 'not_found' as const;
      if (!applicantCanWithdraw(r.status as SiteStatus)) return 'closed' as const;
      await tx.execute("UPDATE site_applications SET status = 'withdrawn' WHERE id = :id", { id });
      await tx.execute(
        `INSERT INTO site_application_events (application_id, from_status, to_status, note, public, created_at)
         VALUES (:a, :f, 'withdrawn', 'Withdrawn by the applicant.', 1, :now)`,
        { a: id, f: r.status, now },
      );
      return 'ok' as const;
    });
  }

  // ---- public tracking (no personal data) ----

  async track(code: string) {
    const [r] = await this.db.query<AppRow>(`${SELECT} WHERE a.tracking_code = :c`, { c: code });
    if (!r) return null;
    return {
      tracking_code: r.tracking_code,
      status: r.status as SiteStatus,
      submitted_at: r.submitted_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
      opportunity: summary(r).opportunity,
      timeline: await this.events(String(r.id), true),
    };
  }

  // ---- staff ----

  async adminList(q: {
    status?: SiteStatus;
    opportunityId?: string;
    q?: string;
    limit: number;
    offset: number;
  }) {
    const where: string[] = ['1 = 1'];
    const params: Record<string, unknown> = { limit: q.limit, offset: q.offset };
    if (q.status) {
      where.push('a.status = :status');
      params.status = q.status;
    }
    if (q.opportunityId) {
      where.push('a.opportunity_id = :opp');
      params.opp = q.opportunityId;
    }
    if (q.q) {
      where.push(
        '(LOWER(a.tracking_code) LIKE :like OR LOWER(a.applicant_name) LIKE :like OR LOWER(a.applicant_email) LIKE :like OR LOWER(o.title) LIKE :like)',
      );
      params.like = `%${q.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    }
    const w = where.join(' AND ');
    const rows = await this.db.query<AppRow>(
      `${SELECT} WHERE ${w} ORDER BY a.submitted_at DESC, a.id DESC LIMIT :limit OFFSET :offset`,
      params,
    );
    const [c] = await this.db.query<Row & { n: number }>(
      `SELECT COUNT(*) AS n FROM site_applications a JOIN opportunities o ON o.id = a.opportunity_id WHERE ${w}`,
      params,
    );
    return {
      items: rows.map((r) => ({
        ...summary(r),
        applicant_name: r.applicant_name,
        applicant_email: r.applicant_email,
        eligibility_status: r.eligibility_status,
      })),
      total: Number(c!.n),
    };
  }

  async statusCounts(): Promise<Record<string, number>> {
    const rows = await this.db.query<Row & { s: string; n: number }>(
      'SELECT status AS s, COUNT(*) AS n FROM site_applications GROUP BY status',
    );
    const out: Record<string, number> = Object.fromEntries(SITE_STATUSES.map((s) => [s, 0]));
    for (const r of rows) out[r.s] = Number(r.n);
    return out;
  }

  async adminGet(id: string) {
    const [r] = await this.db.query<AppRow>(`${SELECT} WHERE a.id = :id`, { id });
    if (!r) return null;
    return {
      ...summary(r),
      applicant_name: r.applicant_name,
      applicant_email: r.applicant_email,
      applicant_phone: r.applicant_phone,
      cover_note: r.cover_note,
      eligibility_status: r.eligibility_status,
      profile_snapshot: parseJson(r.profile_snapshot) ?? null,
      admin_note: r.admin_note,
      timeline: await this.events(String(r.id), false),
    };
  }

  async setStatus(
    id: string,
    to: SiteStatus,
    note: string | null,
    isPublicNote: boolean,
    actor: { id: string; role: string },
    now: Date,
    requestId?: string,
  ): Promise<StaffStatusResult> {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.query<
        Row & { status: string; user_id: string; tracking_code: string; opportunity_id: string }
      >(
        'SELECT status, user_id, tracking_code, opportunity_id FROM site_applications WHERE id = :id FOR UPDATE',
        { id },
      );
      if (!r) return { kind: 'not_found' } as const;
      const from = r.status as SiteStatus;
      if (!staffCanMove(from, to)) return { kind: 'bad_transition', from } as const;
      await tx.execute('UPDATE site_applications SET status = :to WHERE id = :id', { to, id });
      await tx.execute(
        `INSERT INTO site_application_events (application_id, from_status, to_status, note, actor_user_id, public, created_at)
         VALUES (:a, :f, :t, :note, :actor, :pub, :now)`,
        { a: id, f: from, t: to, note, actor: actor.id, pub: isPublicNote ? 1 : 0, now },
      );
      if (isPublicNote) {
        // the applicant is told in the app (email waits for a provider)
        const [opp] = await tx.query<Row & { title: string; title_alt: string | null }>(
          'SELECT title, title_alt FROM opportunities WHERE id = :o',
          { o: String(r.opportunity_id) },
        );
        await tx.execute(
          `INSERT IGNORE INTO notifications (user_id, type, subject_type, subject_id, title_key, params, dedupe_key, created_at)
           VALUES (:u, 'application_update', 'application', :a, 'application_update', :p, :d, :now)`,
          {
            u: String(r.user_id),
            a: id,
            p: JSON.stringify({
              tracking_code: r.tracking_code,
              status: to,
              note: note ?? null,
              title: opp?.title ?? '',
              title_alt: opp?.title_alt ?? null,
            }),
            d: createHash('sha256')
              .update(
                ['application_update', String(r.user_id), id, to, now.toISOString()].join('|'),
              )
              .digest(),
            now,
          },
        );
      }
      await this.audit(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'application.status',
        targetId: id,
        metadata: { from, to },
        ...(requestId ? { requestId } : {}),
      });
      return { kind: 'ok', status: to } as const;
    });
  }

  async auditExport(
    actor: { id: string; role: string },
    rows: number,
    requestId?: string,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, metadata, request_id)
       VALUES (:a, :r, 'application.export', 'site_application', :meta, :req)`,
      {
        a: actor.id,
        r: actor.role.slice(0, 32),
        meta: JSON.stringify({ rows }),
        req: requestId?.slice(0, 40) ?? null,
      },
    );
  }

  async setAdminNote(
    id: string,
    note: string | null,
    actor: { id: string; role: string },
    requestId?: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const res = await tx.execute('UPDATE site_applications SET admin_note = :n WHERE id = :id', {
        n: note,
        id,
      });
      if (res.affectedRows === 0) return false;
      await this.audit(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'application.note',
        targetId: id,
        ...(requestId ? { requestId } : {}),
      });
      return true;
    });
  }

  async recent(limit: number) {
    const rows = await this.db.query<AppRow>(
      `${SELECT} ORDER BY a.submitted_at DESC, a.id DESC LIMIT :limit`,
      { limit },
    );
    return rows.map((r) => ({
      ...summary(r),
      applicant_name: r.applicant_name,
    }));
  }
}
