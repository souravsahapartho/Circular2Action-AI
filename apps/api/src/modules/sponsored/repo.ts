import { createHash } from 'node:crypto';
import type { Clock } from '../../platform/clock';
import type { Db, Row } from '../../db/pool';

export const SPONSOR_DAYS = [3, 7, 14] as const;
export type SponsorStatus = 'pending' | 'active' | 'rejected' | 'ended';

export interface SponsorshipRow {
  id: string;
  opportunity_id: string;
  title: string;
  company: string | null;
  plan: string;
  days: number;
  status: SponsorStatus;
  note: string | null;
  starts_at: string | null;
  ends_at: string | null;
  impressions: number;
  clicks: number;
  created_at: string;
}

type Raw = Row & {
  id: string;
  opportunity_id: string;
  title: string;
  company: string | null;
  plan: string;
  days: number;
  status: SponsorStatus;
  note: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  impressions: number;
  clicks: number;
  created_at: Date;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const shape = (r: Raw): SponsorshipRow => ({
  id: String(r.id),
  opportunity_id: String(r.opportunity_id),
  title: r.title,
  company: r.company,
  plan: r.plan,
  days: Number(r.days),
  status: r.status,
  note: r.note,
  starts_at: iso(r.starts_at),
  ends_at: iso(r.ends_at),
  impressions: Number(r.impressions),
  clicks: Number(r.clicks),
  created_at: r.created_at.toISOString(),
});

const SELECT = `SELECT s.id, s.opportunity_id, o.title, COALESCE(org.name_en, org.name_bn) AS company, s.plan, s.days, s.status, s.note,
                       s.starts_at, s.ends_at, s.impressions, s.clicks, s.created_at
                FROM sponsorships s
                JOIN opportunities o ON o.id = s.opportunity_id
                JOIN organizations org ON org.id = o.organization_id`;

/**
 * Sponsored posts. The "demo" plan is free: nobody is charged until the owner approves a payment provider. Staff
 * decide each request, and an active sponsorship only ever promotes a post that is still published and open.
 */
export class SponsoredRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** An employer asks to promote one of their own published posts. */
  async request(
    ownerUserId: string,
    opportunityId: string,
    days: number,
  ): Promise<'ok' | 'not_found' | 'not_published' | 'exists'> {
    const [o] = await this.db.query<Row & { publication_status: string }>(
      'SELECT publication_status FROM opportunities WHERE id = :id AND owner_user_id = :u',
      { id: opportunityId, u: ownerUserId },
    );
    if (!o) return 'not_found';
    if (o.publication_status !== 'published') return 'not_published';
    const now = this.clock.now();
    const [open] = await this.db.query<Row & { n: number }>(
      `SELECT COUNT(*) AS n FROM sponsorships WHERE opportunity_id = :o
         AND (status = 'pending' OR (status = 'active' AND ends_at > :now))`,
      { o: opportunityId, now },
    );
    if (Number(open?.n ?? 0) > 0) return 'exists';
    await this.db.execute(
      `INSERT INTO sponsorships (opportunity_id, owner_user_id, days, status) VALUES (:o, :u, :d, 'pending')`,
      { o: opportunityId, u: ownerUserId, d: days },
    );
    return 'ok';
  }

  /** Staff start a demo sponsorship at once (for example to seed demo posts). */
  async startByStaff(
    opportunityId: string,
    days: number,
    actor: { id: string; role: string },
    requestId?: string,
  ): Promise<'ok' | 'not_found' | 'not_published'> {
    const [o] = await this.db.query<
      Row & { publication_status: string; owner_user_id: string | null }
    >('SELECT publication_status, owner_user_id FROM opportunities WHERE id = :id', {
      id: opportunityId,
    });
    if (!o) return 'not_found';
    if (o.publication_status !== 'published') return 'not_published';
    const now = this.clock.now();
    const res = await this.db.execute(
      `INSERT INTO sponsorships (opportunity_id, owner_user_id, days, status, starts_at, ends_at, decided_by, decided_at)
       VALUES (:o, :ow, :d, 'active', :s, :e, :a, :s)`,
      {
        o: opportunityId,
        ow: o.owner_user_id,
        d: days,
        s: now,
        e: new Date(now.getTime() + days * 86_400_000),
        a: actor.id,
      },
    );
    await this.audit(actor, 'sponsorship.start', String(res.insertId), requestId);
    return 'ok';
  }

  async listForOwner(ownerUserId: string): Promise<SponsorshipRow[]> {
    const rows = await this.db.query<Raw>(
      `${SELECT} WHERE s.owner_user_id = :u ORDER BY s.created_at DESC LIMIT 100`,
      { u: ownerUserId },
    );
    return rows.map(shape);
  }

  async listAll(f: { status?: SponsorStatus; limit: number; offset: number }): Promise<{
    items: Array<SponsorshipRow & { owner: string | null }>;
    total: number;
  }> {
    const where = f.status ? 'WHERE s.status = :st' : '';
    const params = f.status ? { st: f.status } : {};
    const [t] = await this.db.query<Row & { n: number }>(
      `SELECT COUNT(*) AS n FROM sponsorships s ${where}`,
      params,
    );
    const rows = await this.db.query<Raw & { owner: string | null }>(
      `${SELECT.replace(
        'FROM sponsorships s',
        ', (SELECT u.display_name FROM users u WHERE u.id = s.owner_user_id) AS owner FROM sponsorships s',
      )} ${where} ORDER BY FIELD(s.status, 'pending', 'active', 'ended', 'rejected'), s.created_at DESC
        LIMIT ${Math.floor(f.limit)} OFFSET ${Math.floor(f.offset)}`,
      params,
    );
    return {
      items: rows.map((r) => ({ ...shape(r), owner: r.owner ?? null })),
      total: Number(t?.n ?? 0),
    };
  }

  /** Staff approve or reject a pending request; the employer is told in the app. */
  async decide(
    id: string,
    decision: 'approve' | 'reject',
    note: string | null,
    actor: { id: string; role: string },
    requestId?: string,
  ): Promise<'ok' | 'not_found' | 'not_pending'> {
    const [s] = await this.db.query<
      Row & { status: string; days: number; owner_user_id: string | null; opportunity_id: string }
    >('SELECT status, days, owner_user_id, opportunity_id FROM sponsorships WHERE id = :id', {
      id,
    });
    if (!s) return 'not_found';
    if (s.status !== 'pending') return 'not_pending';
    const now = this.clock.now();
    const approved = decision === 'approve';
    await this.db.execute(
      `UPDATE sponsorships SET status = :st, note = :note, decided_by = :a, decided_at = :now,
              starts_at = :starts, ends_at = :ends WHERE id = :id AND status = 'pending'`,
      {
        st: approved ? 'active' : 'rejected',
        note: note ?? null,
        a: actor.id,
        now,
        starts: approved ? now : null,
        ends: approved ? new Date(now.getTime() + Number(s.days) * 86_400_000) : null,
        id,
      },
    );
    await this.audit(actor, approved ? 'sponsorship.approve' : 'sponsorship.reject', id, requestId);
    if (s.owner_user_id !== null) {
      const [o] = await this.db.query<Row & { title: string }>(
        'SELECT title FROM opportunities WHERE id = :o',
        { o: String(s.opportunity_id) },
      );
      await this.db.execute(
        `INSERT IGNORE INTO notifications (user_id, type, title_key, params, dedupe_key, created_at)
         VALUES (:u, 'announcement', 'announcement', :p, :d, :now)`,
        {
          u: String(s.owner_user_id),
          p: JSON.stringify({
            title: approved ? 'Your sponsored post is live' : 'Your sponsored request was declined',
            message: `${o?.title ?? 'Your post'}${note ? ` · ${note}` : ''}`,
          }),
          d: createHash('sha256').update(['sponsorship', id, decision].join('|')).digest(),
          now,
        },
      );
    }
    return 'ok';
  }

  /** An employer stops their own sponsorship early. */
  async end(ownerUserId: string, id: string): Promise<boolean> {
    const res = await this.db.execute(
      `UPDATE sponsorships SET status = 'ended', ends_at = :now
       WHERE id = :id AND owner_user_id = :u AND status IN ('pending', 'active')`,
      { now: this.clock.now(), id, u: ownerUserId },
    );
    return res.affectedRows > 0;
  }

  /** Opportunity ids that are sponsored right now and still open to apply to. */
  async activeOpportunityIds(): Promise<string[]> {
    const now = this.clock.now();
    const rows = await this.db.query<Row & { opportunity_id: string }>(
      `SELECT DISTINCT s.opportunity_id FROM sponsorships s
       JOIN opportunities o ON o.id = s.opportunity_id
       WHERE s.status = 'active' AND s.ends_at > :now
         AND o.publication_status = 'published' AND o.lifecycle_status = 'open'
         AND (o.deadline_at IS NULL OR o.deadline_at > :now) LIMIT 200`,
      { now },
    );
    return rows.map((r) => String(r.opportunity_id));
  }

  async recordImpressions(opportunityIds: string[]): Promise<void> {
    if (opportunityIds.length === 0) return;
    await this.db.execute(
      `UPDATE sponsorships SET impressions = impressions + 1
       WHERE opportunity_id IN (:ids) AND status = 'active' AND ends_at > :now`,
      { ids: opportunityIds, now: this.clock.now() },
    );
  }

  async recordClick(opportunityId: string): Promise<void> {
    await this.db.execute(
      `UPDATE sponsorships SET clicks = clicks + 1
       WHERE opportunity_id = :o AND status = 'active' AND ends_at > :now`,
      { o: opportunityId, now: this.clock.now() },
    );
  }

  private async audit(
    actor: { id: string; role: string },
    action: string,
    targetId: string,
    requestId?: string,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, request_id)
       VALUES (:a, :r, :act, 'sponsorship', :t, :req)`,
      {
        a: actor.id,
        r: actor.role.slice(0, 32),
        act: action,
        t: targetId,
        req: requestId?.slice(0, 40) ?? null,
      },
    );
  }
}
