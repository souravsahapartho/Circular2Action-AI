import { createHash, randomBytes } from 'node:crypto';
import type { Db, Row } from '../../db/pool';
import type { Clock } from '../../platform/clock';
import { normalizeEmail } from '../auth/crypto';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Fills missing days with zero so a chart has one bar per day. */
export function fillDays(rows: Array<{ day: string; n: number }>, to: Date, days: number) {
  const by = new Map(rows.map((r) => [r.day, r.n]));
  const out: Array<{ day: string; n: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = day(new Date(to.getTime() - i * 86_400_000));
    out.push({ day: d, n: by.get(d) ?? 0 });
  }
  return out;
}

/** Spreadsheet programs run text that starts with = + - or @ as a formula, so such cells get a leading quote. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface ApplicationExportRow {
  tracking_code: string;
  status: string;
  submitted_at: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  eligibility_status: string | null;
  opportunity: string;
  organization: string;
}

/** Numbers and tools the staff portal needs beyond the plain lists (plan v1.3 admin power). */
export class AdminInsights {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async analytics() {
    const now = this.clock.now();
    const since14 = new Date(now.getTime() - 14 * 86_400_000);
    const since30 = new Date(now.getTime() - 30 * 86_400_000);
    const n = async (sql: string, params?: Record<string, unknown>) => {
      const [r] = await this.db.query<Row & { n: number }>(sql, params);
      return Number(r!.n);
    };
    const [users, published, apps, web, notes, interactions] = await Promise.all([
      n('SELECT COUNT(*) AS n FROM users'),
      n("SELECT COUNT(*) AS n FROM opportunities WHERE publication_status = 'published'"),
      n('SELECT COUNT(*) AS n FROM site_applications'),
      n('SELECT COUNT(*) AS n FROM external_listings WHERE hidden = 0'),
      n('SELECT COUNT(*) AS n FROM notifications'),
      n('SELECT COUNT(*) AS n FROM interaction_events WHERE created_at > :s', { s: since30 }),
    ]);
    const series = async (table: string, col: string) =>
      fillDays(
        (
          await this.db.query<Row & { d: string | Date; n: number }>(
            `SELECT DATE(${col}) AS d, COUNT(*) AS n FROM ${table} WHERE ${col} > :s GROUP BY DATE(${col})`,
            { s: since14 },
          )
        ).map((r) => ({
          day: typeof r.d === 'string' ? r.d.slice(0, 10) : day(r.d),
          n: Number(r.n),
        })),
        now,
        14,
      );
    const [signups, applications] = await Promise.all([
      series('users', 'created_at'),
      series('site_applications', 'submitted_at'),
    ]);
    const funnelRows = await this.db.query<Row & { s: string; n: number }>(
      'SELECT status AS s, COUNT(*) AS n FROM site_applications GROUP BY status',
    );
    const byCategory = await this.db.query<
      Row & { slug: string; name_en: string; opportunities: number; applications: number }
    >(
      `SELECT c.slug, c.name_en,
              (SELECT COUNT(*) FROM opportunities o WHERE o.category_id = c.id AND o.publication_status = 'published') AS opportunities,
              (SELECT COUNT(*) FROM site_applications a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.category_id = c.id) AS applications
       FROM opportunity_categories c WHERE c.is_active = 1 ORDER BY c.sort_order, c.id`,
    );
    const top = await this.db.query<
      Row & {
        id: string;
        title: string;
        title_alt: string | null;
        applications: number;
        saves: number;
      }
    >(
      `SELECT o.id, o.title, o.title_alt,
              (SELECT COUNT(*) FROM site_applications a WHERE a.opportunity_id = o.id) AS applications,
              (SELECT COUNT(*) FROM saved_opportunities s WHERE s.opportunity_id = o.id) AS saves
       FROM opportunities o WHERE o.publication_status = 'published'
       ORDER BY (applications * 3 + saves) DESC, o.id LIMIT 5`,
    );
    const web_by_source = await this.db.query<Row & { source: string; n: number }>(
      'SELECT source, COUNT(*) AS n FROM external_listings WHERE hidden = 0 GROUP BY source',
    );
    const activity = await this.db.query<Row & { kind: string; n: number }>(
      'SELECT kind, COUNT(*) AS n FROM interaction_events WHERE created_at > :s GROUP BY kind',
      { s: since30 },
    );
    const alertsWithAlertsOn = await n(
      'SELECT COUNT(*) AS n FROM job_preferences WHERE alerts_enabled = 1',
    );
    return {
      totals: {
        users,
        published_opportunities: published,
        site_applications: apps,
        web_listings: web,
        notifications: notes,
        activity_30d: interactions,
        people_with_alerts: alertsWithAlertsOn,
      },
      signups_14d: signups,
      applications_14d: applications,
      funnel: Object.fromEntries(funnelRows.map((r) => [r.s, Number(r.n)])),
      by_category: byCategory.map((r) => ({
        slug: r.slug,
        name: r.name_en,
        opportunities: Number(r.opportunities),
        applications: Number(r.applications),
      })),
      top_opportunities: top.map((r) => ({
        id: String(r.id),
        title: r.title,
        title_alt: r.title_alt,
        applications: Number(r.applications),
        saves: Number(r.saves),
      })),
      web_by_source: web_by_source.map((r) => ({ source: r.source, n: Number(r.n) })),
      activity_30d: activity.map((r) => ({ kind: r.kind, n: Number(r.n) })),
    };
  }

  async exportApplications(f: { status?: string; q?: string }): Promise<ApplicationExportRow[]> {
    const where = ['1 = 1'];
    const params: Record<string, unknown> = {};
    if (f.status) {
      where.push('a.status = :status');
      params.status = f.status;
    }
    if (f.q) {
      where.push(
        '(LOWER(a.tracking_code) LIKE :like OR LOWER(a.applicant_name) LIKE :like OR LOWER(a.applicant_email) LIKE :like OR LOWER(o.title) LIKE :like)',
      );
      params.like = `%${f.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    }
    const rows = await this.db.query<
      Row & {
        tracking_code: string;
        status: string;
        submitted_at: Date;
        applicant_name: string;
        applicant_email: string;
        applicant_phone: string | null;
        eligibility_status: string | null;
        title: string;
        title_alt: string | null;
        org_en: string | null;
        org_bn: string | null;
      }
    >(
      `SELECT a.tracking_code, a.status, a.submitted_at, a.applicant_name, a.applicant_email, a.applicant_phone,
              a.eligibility_status, o.title, o.title_alt, org.name_en AS org_en, org.name_bn AS org_bn
       FROM site_applications a JOIN opportunities o ON o.id = a.opportunity_id
         JOIN organizations org ON org.id = o.organization_id
       WHERE ${where.join(' AND ')} ORDER BY a.submitted_at DESC LIMIT 5000`,
      params,
    );
    return rows.map((r) => ({
      tracking_code: r.tracking_code,
      status: r.status,
      submitted_at: r.submitted_at.toISOString(),
      applicant_name: r.applicant_name,
      applicant_email: r.applicant_email,
      applicant_phone: r.applicant_phone,
      eligibility_status: r.eligibility_status,
      opportunity: r.title_alt ? `${r.title} / ${r.title_alt}` : r.title,
      organization: r.org_en ?? r.org_bn ?? '',
    }));
  }

  /** Suspends or restores an account. A suspended person is signed out everywhere. Never touches accounts pending deletion. */
  async setUserStatus(
    id: string,
    status: 'active' | 'suspended',
    actor: { id: string; role: string },
    reason: string | null,
    requestId?: string,
  ): Promise<'ok' | 'not_found' | 'pending_deletion'> {
    return this.db.transaction(async (tx) => {
      const [u] = await tx.query<Row & { status: string }>(
        'SELECT status FROM users WHERE id = :id FOR UPDATE',
        { id },
      );
      if (!u) return 'not_found' as const;
      if (u.status === 'pending_deletion') return 'pending_deletion' as const;
      await tx.execute('UPDATE users SET status = :s WHERE id = :id', { s: status, id });
      if (status === 'suspended') {
        await tx.execute('DELETE FROM user_sessions WHERE user_id = :id', { id });
      }
      await tx.execute(
        `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, reason, metadata, request_id)
         VALUES (:a, :r, :act, 'user', :t, :reason, :meta, :req)`,
        {
          a: actor.id,
          r: actor.role.slice(0, 32),
          act: status === 'suspended' ? 'user.suspend' : 'user.restore',
          t: id,
          reason: reason?.slice(0, 500) ?? null,
          meta: JSON.stringify({ from: u.status, to: status }),
          req: requestId?.slice(0, 40) ?? null,
        },
      );
      return 'ok' as const;
    });
  }

  /**
   * A staff announcement shown in each person's notifications: to everyone, or to people interested in one category
   * (they chose it, or looked at it in the last 90 days). Returns how many people were told.
   */
  async broadcast(
    input: {
      title: string;
      message: string;
      audience: 'all' | 'seekers' | 'employers' | 'category' | 'user';
      categorySlug?: string;
      email?: string;
    },
    actor: { id: string; role: string },
    requestId?: string,
  ): Promise<number> {
    const now = this.clock.now();
    let ids: string[];
    if (input.audience === 'category' && input.categorySlug) {
      const since = new Date(now.getTime() - 90 * 86_400_000);
      const rows = await this.db.query<Row & { id: string }>(
        `SELECT u.id FROM users u WHERE u.status = 'active' AND (
            u.id IN (SELECT user_id FROM job_preferences WHERE JSON_CONTAINS(categories, JSON_QUOTE(:c)))
            OR u.id IN (SELECT user_id FROM interaction_events WHERE category_slug = :c AND created_at > :since)
          ) LIMIT 20000`,
        { c: input.categorySlug, since },
      );
      ids = rows.map((r) => String(r.id));
    } else if (input.audience === 'user' && input.email) {
      const rows = await this.db.query<Row & { id: string }>(
        "SELECT id FROM users WHERE status = 'active' AND email_normalized = :e LIMIT 1",
        { e: normalizeEmail(input.email) },
      );
      ids = rows.map((r) => String(r.id));
    } else if (input.audience === 'employers') {
      const rows = await this.db.query<Row & { id: string }>(
        "SELECT u.id FROM users u WHERE u.status = 'active' AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'employer') LIMIT 20000",
      );
      ids = rows.map((r) => String(r.id));
    } else if (input.audience === 'seekers') {
      const rows = await this.db.query<Row & { id: string }>(
        "SELECT u.id FROM users u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role <> 'user') LIMIT 20000",
      );
      ids = rows.map((r) => String(r.id));
    } else {
      const rows = await this.db.query<Row & { id: string }>(
        "SELECT id FROM users WHERE status = 'active' LIMIT 20000",
      );
      ids = rows.map((r) => String(r.id));
    }
    const batchKey = randomBytes(8).toString('hex');
    const params = JSON.stringify({ title: input.title, message: input.message });
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const values: unknown[] = [];
      const marks = chunk
        .map((uid) => {
          values.push(
            uid,
            'announcement',
            'announcement',
            params,
            createHash('sha256').update(['announcement', uid, batchKey].join('|')).digest(),
            now,
          );
          return '(?, ?, ?, ?, ?, ?)';
        })
        .join(', ');
      await this.db.execute(
        `INSERT IGNORE INTO notifications (user_id, type, title_key, params, dedupe_key, created_at) VALUES ${marks}`,
        values,
      );
    }
    await this.db.execute(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, metadata, request_id)
       VALUES (:a, :r, 'notification.broadcast', 'notification', :meta, :req)`,
      {
        a: actor.id,
        r: actor.role.slice(0, 32),
        meta: JSON.stringify({
          audience: input.audience,
          category: input.categorySlug ?? null,
          message: input.message.slice(0, 200),
          told: ids.length,
          title: input.title,
        }),
        req: requestId?.slice(0, 40) ?? null,
      },
    );
    return ids.length;
  }

  /** The latest announcements staff sent, newest first, for the notification board. */
  async broadcastHistory(limit = 30): Promise<
    Array<{
      id: string;
      at: string;
      audience: string;
      category: string | null;
      title: string;
      message: string;
      told: number;
    }>
  > {
    const n = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = await this.db.query<Row & { id: string; created_at: Date; metadata: unknown }>(
      `SELECT id, created_at, metadata FROM audit_logs WHERE action = 'notification.broadcast'
       ORDER BY created_at DESC LIMIT ${n}`,
    );
    return rows.map((r) => {
      const m = (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata ?? {})) as {
        audience?: string;
        category?: string | null;
        title?: string;
        message?: string;
        told?: number;
      };
      return {
        id: String(r.id),
        at: r.created_at.toISOString(),
        audience: m.audience ?? 'all',
        category: m.category ?? null,
        title: m.title ?? '',
        message: m.message ?? '',
        told: Number(m.told ?? 0),
      };
    });
  }
}
