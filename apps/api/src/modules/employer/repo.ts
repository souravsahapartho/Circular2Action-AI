import { randomBytes } from 'node:crypto';
import { normalizeForMatch } from '@c2a/normalize';
import type { Db, Row } from '../../db/pool';
import type { Clock } from '../../platform/clock';
import type { AdminOpportunityInput, AdminRepo } from '../admin/repo';

export interface CompanyInput {
  company_name: string;
  website?: string | null;
  phone?: string | null;
}

export interface EmployerProfile {
  organization_id: string;
  company_name: string;
  website: string | null;
  phone: string | null;
  verification_status: string;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

export type SubmitResult = 'ok' | 'not_found' | 'bad_state' | 'incomplete';

/** Everything an employer (recruiter) does: their company, their own posts, the applications to them. Scoped by owner. */
export class EmployerRepo {
  constructor(
    private readonly db: Db,
    private readonly admin: AdminRepo,
    private readonly clock: Clock,
  ) {}

  /** Creates the company and the employer role for a new account. Called right after the account is created. */
  async createAccount(userId: string, c: CompanyInput): Promise<void> {
    const base = slugify(c.company_name) || 'company';
    await this.db.transaction(async (tx) => {
      let slug = base;
      for (let i = 0; i < 5; i++) {
        const [dup] = await tx.query<Row & { id: string }>(
          'SELECT id FROM organizations WHERE slug = :s',
          {
            s: slug,
          },
        );
        if (!dup) break;
        slug = `${base}-${randomBytes(3).toString('hex')}`;
      }
      const org = await tx.execute(
        `INSERT INTO organizations (slug, name_en, name_normalized, type, website_url, verification_status)
         VALUES (:s, :n, :nn, 'private', :w, 'unverified')`,
        {
          s: slug,
          n: c.company_name,
          nn: normalizeForMatch(c.company_name),
          w: c.website ?? null,
        },
      );
      await tx.execute(
        'INSERT INTO employer_profiles (user_id, organization_id, contact_phone) VALUES (:u, :o, :p)',
        { u: userId, o: String(org.insertId), p: c.phone ?? null },
      );
      await tx.execute("INSERT INTO user_roles (user_id, role) VALUES (:u, 'employer')", {
        u: userId,
      });
    });
  }

  async profile(userId: string): Promise<EmployerProfile | null> {
    const [r] = await this.db.query<
      Row & {
        organization_id: string;
        contact_phone: string | null;
        name_en: string | null;
        name_bn: string | null;
        website_url: string | null;
        verification_status: string;
      }
    >(
      `SELECT p.organization_id, p.contact_phone, o.name_en, o.name_bn, o.website_url, o.verification_status
       FROM employer_profiles p JOIN organizations o ON o.id = p.organization_id WHERE p.user_id = :u`,
      { u: userId },
    );
    if (!r) return null;
    return {
      organization_id: String(r.organization_id),
      company_name: r.name_en ?? r.name_bn ?? '',
      website: r.website_url,
      phone: r.contact_phone,
      verification_status: r.verification_status,
    };
  }

  async updateProfile(userId: string, c: Partial<CompanyInput>): Promise<boolean> {
    const p = await this.profile(userId);
    if (!p) return false;
    await this.db.transaction(async (tx) => {
      if (c.company_name !== undefined) {
        await tx.execute(
          'UPDATE organizations SET name_en = :n, name_normalized = :nn WHERE id = :o',
          {
            n: c.company_name,
            nn: normalizeForMatch(c.company_name),
            o: p.organization_id,
          },
        );
      }
      if (c.website !== undefined) {
        await tx.execute('UPDATE organizations SET website_url = :w WHERE id = :o', {
          w: c.website,
          o: p.organization_id,
        });
      }
      if (c.phone !== undefined) {
        await tx.execute('UPDATE employer_profiles SET contact_phone = :p WHERE user_id = :u', {
          p: c.phone,
          u: userId,
        });
      }
    });
    return true;
  }

  async overview(userId: string) {
    const byStatus = await this.db.query<Row & { s: string; n: number }>(
      'SELECT publication_status AS s, COUNT(*) AS n FROM opportunities WHERE owner_user_id = :u GROUP BY publication_status',
      { u: userId },
    );
    const apps = await this.db.query<Row & { s: string; n: number }>(
      `SELECT a.status AS s, COUNT(*) AS n FROM site_applications a
       JOIN opportunities o ON o.id = a.opportunity_id WHERE o.owner_user_id = :u GROUP BY a.status`,
      { u: userId },
    );
    const [saves] = await this.db.query<Row & { n: number }>(
      `SELECT COUNT(*) AS n FROM saved_opportunities s JOIN opportunities o ON o.id = s.opportunity_id
       WHERE o.owner_user_id = :u`,
      { u: userId },
    );
    const top = await this.db.query<
      Row & { id: string; title: string; applications: number; saves: number }
    >(
      `SELECT o.id, o.title,
              (SELECT COUNT(*) FROM site_applications a WHERE a.opportunity_id = o.id) AS applications,
              (SELECT COUNT(*) FROM saved_opportunities s WHERE s.opportunity_id = o.id) AS saves
       FROM opportunities o WHERE o.owner_user_id = :u AND o.publication_status = 'published'
       ORDER BY (applications * 3 + saves) DESC, o.id LIMIT 5`,
      { u: userId },
    );
    return {
      posts: Object.fromEntries(byStatus.map((r) => [r.s, Number(r.n)])),
      applications: Object.fromEntries(apps.map((r) => [r.s, Number(r.n)])),
      saves: Number(saves!.n),
      top_posts: top.map((t) => ({
        id: String(t.id),
        title: t.title,
        applications: Number(t.applications),
        saves: Number(t.saves),
      })),
    };
  }

  async list(userId: string, f: { status?: string; q?: string; limit: number; offset: number }) {
    const where = ['o.owner_user_id = :u'];
    const params: Record<string, unknown> = { u: userId, limit: f.limit, offset: f.offset };
    if (f.status) {
      where.push('o.publication_status = :st');
      params.st = f.status;
    }
    if (f.q) {
      where.push('(LOWER(o.title) LIKE :like OR LOWER(o.title_alt) LIKE :like)');
      params.like = `%${f.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    }
    const w = where.join(' AND ');
    const rows = await this.db.query<
      Row & {
        id: string;
        slug: string;
        title: string;
        cat: string;
        publication_status: string;
        deadline_at: Date | null;
        updated_at: Date;
        apply_mode: string;
        applications: number;
        saves: number;
      }
    >(
      `SELECT o.id, o.slug, o.title, c.slug AS cat, o.publication_status, o.deadline_at, o.updated_at, o.apply_mode,
              (SELECT COUNT(*) FROM site_applications a WHERE a.opportunity_id = o.id) AS applications,
              (SELECT COUNT(*) FROM saved_opportunities sv WHERE sv.opportunity_id = o.id) AS saves
       FROM opportunities o JOIN opportunity_categories c ON c.id = o.category_id
       WHERE ${w} ORDER BY o.updated_at DESC, o.id DESC LIMIT :limit OFFSET :offset`,
      params,
    );
    const [c] = await this.db.query<Row & { n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities o WHERE ${w}`,
      params,
    );
    return {
      total: Number(c!.n),
      items: rows.map((r) => ({
        id: String(r.id),
        slug: r.slug,
        title: r.title,
        category_slug: r.cat,
        publication_status: r.publication_status,
        deadline_at: r.deadline_at ? r.deadline_at.toISOString() : null,
        updated_at: r.updated_at.toISOString(),
        apply_mode: r.apply_mode,
        applications: Number(r.applications),
        saves: Number(r.saves),
      })),
    };
  }

  async owns(userId: string, opportunityId: string): Promise<boolean> {
    const [r] = await this.db.query<Row & { id: string }>(
      'SELECT id FROM opportunities WHERE id = :id AND owner_user_id = :u',
      { id: opportunityId, u: userId },
    );
    return Boolean(r);
  }

  async ownsApplication(userId: string, applicationId: string): Promise<boolean> {
    const [r] = await this.db.query<Row & { id: string }>(
      `SELECT a.id FROM site_applications a JOIN opportunities o ON o.id = a.opportunity_id
       WHERE a.id = :id AND o.owner_user_id = :u`,
      { id: applicationId, u: userId },
    );
    return Boolean(r);
  }

  /** How many posts this employer created today (a spam brake for open sign-up). */
  async createdSince(userId: string, since: Date): Promise<number> {
    const [r] = await this.db.query<Row & { n: number }>(
      'SELECT COUNT(*) AS n FROM opportunities WHERE owner_user_id = :u AND created_at > :s',
      { u: userId, s: since },
    );
    return Number(r!.n);
  }

  /** A new draft, always under the employer's own company. */
  async create(
    userId: string,
    input: Omit<AdminOpportunityInput, 'organization_id'>,
    requestId: string,
  ): Promise<{ id: string } | 'no_company' | 'bad_category'> {
    const p = await this.profile(userId);
    if (!p) return 'no_company';
    const res = await this.admin.create(
      { ...input, organization_id: p.organization_id },
      { id: userId, role: 'employer' },
      requestId,
    );
    if (res === 'bad_category') return 'bad_category';
    if (res === 'bad_organization') return 'no_company';
    await this.db.execute('UPDATE opportunities SET owner_user_id = :u WHERE id = :id', {
      u: userId,
      id: res.id,
    });
    return res;
  }

  async get(userId: string, id: string) {
    if (!(await this.owns(userId, id))) return null;
    return this.admin.get(id);
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<Omit<AdminOpportunityInput, 'organization_id'>>,
    expectedUpdatedAt: string,
    requestId: string,
  ) {
    if (!(await this.owns(userId, id))) return 'not_found' as const;
    const [cur] = await this.db.query<Row & { publication_status: string }>(
      'SELECT publication_status FROM opportunities WHERE id = :id',
      { id },
    );
    // a post that is live is closed first; editing it quietly would change what people already saw
    if (cur?.publication_status === 'published' || cur?.publication_status === 'removed') {
      return 'locked' as const;
    }
    return this.admin.update(
      id,
      patch as AdminOpportunityInput,
      expectedUpdatedAt,
      { id: userId, role: 'employer' },
      requestId,
    );
  }

  /** Sends a draft to staff for approval. Needs the basics so reviewers are not handed an empty shell. */
  async submit(userId: string, id: string, requestId: string): Promise<SubmitResult> {
    if (!(await this.owns(userId, id))) return 'not_found';
    return this.db.transaction(async (tx) => {
      const [o] = await tx.query<
        Row & {
          publication_status: string;
          summary_bn: string | null;
          summary_en: string | null;
          deadline_at: Date | null;
        }
      >(
        'SELECT publication_status, summary_bn, summary_en, deadline_at FROM opportunities WHERE id = :id FOR UPDATE',
        { id },
      );
      if (!o) return 'not_found' as const;
      if (!['draft', 'unpublished'].includes(o.publication_status)) return 'bad_state' as const;
      if (!(o.summary_bn || o.summary_en) || !o.deadline_at) return 'incomplete' as const;
      await tx.execute("UPDATE opportunities SET publication_status = 'in_review' WHERE id = :id", {
        id,
      });
      await tx.execute(
        `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, request_id)
         VALUES (:a, 'employer', 'opportunity.submit', 'opportunity', :t, :req)`,
        { a: userId, t: id, req: requestId.slice(0, 40) },
      );
      return 'ok' as const;
    });
  }

  /** Takes a live post down (it can be edited and submitted again). */
  async close(
    userId: string,
    id: string,
    requestId: string,
  ): Promise<'ok' | 'not_found' | 'bad_state'> {
    if (!(await this.owns(userId, id))) return 'not_found';
    const res = await this.db.transaction(async (tx) => {
      const [o] = await tx.query<Row & { publication_status: string }>(
        'SELECT publication_status FROM opportunities WHERE id = :id FOR UPDATE',
        { id },
      );
      if (!o) return 'not_found' as const;
      if (!['published', 'in_review'].includes(o.publication_status)) return 'bad_state' as const;
      await tx.execute(
        "UPDATE opportunities SET publication_status = 'unpublished' WHERE id = :id",
        { id },
      );
      await tx.execute(
        `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, request_id)
         VALUES (:a, 'employer', 'opportunity.close', 'opportunity', :t, :req)`,
        { a: userId, t: id, req: requestId.slice(0, 40) },
      );
      return 'ok' as const;
    });
    return res;
  }

  /** Tell the employer in the app when someone applies to one of their posts. */
  async notifyNewApplication(applicationId: string, opportunityId: string): Promise<void> {
    const [o] = await this.db.query<Row & { owner_user_id: string | null; title: string }>(
      'SELECT owner_user_id, title FROM opportunities WHERE id = :id',
      { id: opportunityId },
    );
    if (!o || o.owner_user_id === null) return;
    const { createHash } = await import('node:crypto');
    await this.db.execute(
      `INSERT IGNORE INTO notifications (user_id, type, subject_type, subject_id, title_key, params, dedupe_key, created_at)
       VALUES (:u, 'new_application', 'application', :a, 'new_application', :p, :d, :now)`,
      {
        u: String(o.owner_user_id),
        a: applicationId,
        p: JSON.stringify({ title: o.title }),
        d: createHash('sha256').update(['new_application', applicationId].join('|')).digest(),
        now: this.clock.now(),
      },
    );
  }
}
