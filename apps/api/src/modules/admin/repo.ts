import { randomBytes } from 'node:crypto';
import { normalizeForMatch, slugify } from '@c2a/normalize';
import type { Role } from '@c2a/contracts';
import type { Db, Executor, Row } from '../../db/pool';
import { OpportunityRepo } from '../opportunities/repo';

export interface AdminOpportunityInput {
  title: string;
  title_alt?: string | null;
  organization_id: string;
  category_slug: string;
  position_title?: string | null;
  summary_bn?: string | null;
  summary_en?: string | null;
  vacancies?: number | null;
  deadline_at?: Date | null;
  location_slug?: string | null;
  official_url?: string | null;
  application_url?: string | null;
  how_to_apply?: string | null;
  required_documents?: Array<{ label: string; note?: string }> | null;
  requirements?: Array<{
    rule_type: string;
    necessity: 'mandatory' | 'preferred' | 'conditional';
    params: Record<string, unknown>;
    text?: string | null;
  }>;
}

export interface AdminOpportunityRow {
  id: string;
  slug: string;
  title: string;
  title_alt: string | null;
  organization_id: string;
  organization: string;
  category_slug: string;
  position_title: string | null;
  summary_bn: string | null;
  summary_en: string | null;
  vacancies: number | null;
  deadline_at: string | null;
  location_slug: string | null;
  official_url: string | null;
  application_url: string | null;
  how_to_apply: string | null;
  required_documents: Array<{ label: string; note?: string }> | null;
  publication_status: string;
  lifecycle_status: string;
  verification_state: string;
  published_at: string | null;
  updated_at: string;
  requirements: Array<{
    id: string;
    rule_type: string;
    necessity: string;
    params: Record<string, unknown>;
    text: string | null;
    verified: boolean;
  }>;
}

const STAFF_SOURCE = 'Staff entry (manual)';

/** Staff-side SQL: drafts, edits, publication workflow, organisations, users, audit log. */
export class AdminRepo {
  private readonly opps: OpportunityRepo;
  constructor(private readonly db: Db) {
    this.opps = new OpportunityRepo(db);
  }

  async audit(
    tx: Executor | null,
    e: {
      actorId: string;
      actorRole: string;
      action: string;
      targetType?: string;
      targetId?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
      requestId?: string;
    },
  ): Promise<void> {
    await (tx ?? this.db).execute(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, reason, metadata, request_id)
       VALUES (:a, :r, :act, :tt, :ti, :reason, :meta, :req)`,
      {
        a: e.actorId,
        r: e.actorRole.slice(0, 32),
        act: e.action,
        tt: e.targetType ?? null,
        ti: e.targetId ?? null,
        reason: e.reason?.slice(0, 500) ?? null,
        meta: e.metadata ? JSON.stringify(e.metadata) : null,
        req: e.requestId?.slice(0, 40) ?? null,
      },
    );
  }

  // ---- overview ----
  async overview() {
    const byStatus = await this.db.query<Row & { s: string; n: number }>(
      'SELECT publication_status AS s, COUNT(*) AS n FROM opportunities GROUP BY publication_status',
    );
    const [u] = await this.db.query<Row & { n: number }>('SELECT COUNT(*) AS n FROM users');
    const [a] = await this.db.query<Row & { n: number }>(
      'SELECT COUNT(*) AS n FROM application_records',
    );
    const [o] = await this.db.query<Row & { n: number }>('SELECT COUNT(*) AS n FROM organizations');
    return {
      opportunities: Object.fromEntries(byStatus.map((r) => [r.s, Number(r.n)])),
      users: Number(u!.n),
      applications: Number(a!.n),
      organizations: Number(o!.n),
    };
  }

  // ---- organisations ----
  async listOrganizations(q?: string) {
    const norm = q ? normalizeForMatch(q) : '';
    const rows = await this.db.query<
      Row & {
        id: string;
        slug: string;
        name_en: string | null;
        name_bn: string | null;
        type: string;
        verification_status: string;
      }
    >(
      `SELECT id, slug, name_en, name_bn, type, verification_status FROM organizations
       ${norm ? 'WHERE name_normalized LIKE :q' : ''} ORDER BY name_en, id LIMIT 200`,
      { q: `%${norm.replace(/[\\%_]/g, (m) => `\\${m}`)}%` },
    );
    return rows.map((r) => ({ ...r, id: String(r.id) }));
  }

  async createOrganization(input: {
    name_en?: string | null;
    name_bn?: string | null;
    type: string;
    website_url?: string | null;
  }): Promise<{ id: string } | 'exists'> {
    const base = slugify(input.name_en ?? input.name_bn ?? 'organisation');
    const slug = base || `org-${randomBytes(4).toString('hex')}`;
    const dup = await this.db.query<Row & { id: string }>(
      'SELECT id FROM organizations WHERE slug = :s',
      { s: slug },
    );
    if (dup[0]) return 'exists';
    const res = await this.db.execute(
      `INSERT INTO organizations (slug, name_en, name_bn, name_normalized, type, website_url, verification_status)
       VALUES (:s, :en, :bn, :n, :t, :w, 'unverified')`,
      {
        s: slug,
        en: input.name_en ?? null,
        bn: input.name_bn ?? null,
        n: normalizeForMatch([input.name_en, input.name_bn].filter(Boolean).join(' ')),
        t: input.type,
        w: input.website_url ?? null,
      },
    );
    return { id: String(res.insertId) };
  }

  // ---- opportunities ----
  async list(filter: { status?: string; q?: string; limit: number; offset: number }) {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: filter.limit, offset: filter.offset };
    if (filter.status) {
      where.push('o.publication_status = :st');
      params.st = filter.status;
    }
    const norm = filter.q ? normalizeForMatch(filter.q) : '';
    if (filter.q) {
      where.push(
        '(o.title LIKE :q OR o.title_alt LIKE :q OR org.name_en LIKE :q OR org.name_bn LIKE :q)',
      );
      params.q = `%${filter.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    }
    void norm;
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query<
      Row & {
        id: string;
        slug: string;
        title: string;
        org_en: string | null;
        org_bn: string | null;
        cat: string;
        publication_status: string;
        deadline_at: Date | null;
        updated_at: Date;
      }
    >(
      `SELECT o.id, o.slug, o.title, org.name_en AS org_en, org.name_bn AS org_bn, c.slug AS cat,
              o.publication_status, o.deadline_at, o.updated_at
       FROM opportunities o JOIN organizations org ON org.id = o.organization_id
         JOIN opportunity_categories c ON c.id = o.category_id
       ${w} ORDER BY o.updated_at DESC, o.id DESC LIMIT :limit OFFSET :offset`,
      params,
    );
    const [c] = await this.db.query<Row & { n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities o JOIN organizations org ON org.id = o.organization_id ${w}`,
      params,
    );
    return {
      total: Number(c!.n),
      items: rows.map((r) => ({
        id: String(r.id),
        slug: r.slug,
        title: r.title,
        organization: r.org_en ?? r.org_bn ?? '',
        category_slug: r.cat,
        publication_status: r.publication_status,
        deadline_at: r.deadline_at ? r.deadline_at.toISOString() : null,
        updated_at: r.updated_at.toISOString(),
      })),
    };
  }

  async get(id: string): Promise<AdminOpportunityRow | null> {
    const rows = await this.db.query<
      Row & {
        id: string;
        slug: string;
        title: string;
        title_alt: string | null;
        organization_id: string;
        org_en: string | null;
        org_bn: string | null;
        cat: string;
        position_title: string | null;
        summary_bn: string | null;
        summary_en: string | null;
        vacancies: number | null;
        deadline_at: Date | null;
        application_url: string | null;
        how_to_apply: string | null;
        required_documents: unknown;
        publication_status: string;
        lifecycle_status: string;
        published_at: Date | null;
        updated_at: Date;
        official_url: string | null;
        verification_state: string;
        loc: string | null;
      }
    >(
      `SELECT o.id, o.slug, o.title, o.title_alt, o.organization_id, org.name_en AS org_en, org.name_bn AS org_bn,
              c.slug AS cat, o.position_title, o.summary_bn, o.summary_en, o.vacancies, o.deadline_at,
              o.application_url, o.how_to_apply, o.required_documents, o.publication_status, o.lifecycle_status,
              o.published_at, o.updated_at, ci.official_url, ci.verification_state,
              (SELECT l.slug FROM opportunity_locations ol JOIN locations l ON l.id = ol.location_id
                 WHERE ol.opportunity_id = o.id ORDER BY l.id LIMIT 1) AS loc
       FROM opportunities o JOIN organizations org ON org.id = o.organization_id
         JOIN opportunity_categories c ON c.id = o.category_id JOIN circulars ci ON ci.id = o.circular_id
       WHERE o.id = :id`,
      { id },
    );
    const r = rows[0];
    if (!r) return null;
    const reqs = await this.db.query<
      Row & {
        id: string;
        rule_type: string;
        necessity: string;
        params: unknown;
        source_text: string | null;
        verification_state: string;
      }
    >(
      `SELECT id, rule_type, necessity, params, source_text, verification_state
       FROM opportunity_requirements WHERE opportunity_id = :id ORDER BY sort_order, id`,
      { id },
    );
    const parse = <T>(v: unknown): T | null =>
      v === null || v === undefined
        ? null
        : typeof v === 'string'
          ? (JSON.parse(v) as T)
          : (v as T);
    return {
      id: String(r.id),
      slug: r.slug,
      title: r.title,
      title_alt: r.title_alt,
      organization_id: String(r.organization_id),
      organization: r.org_en ?? r.org_bn ?? '',
      category_slug: r.cat,
      position_title: r.position_title,
      summary_bn: r.summary_bn,
      summary_en: r.summary_en,
      vacancies: r.vacancies === null ? null : Number(r.vacancies),
      deadline_at: r.deadline_at ? r.deadline_at.toISOString() : null,
      location_slug: r.loc,
      official_url: r.official_url,
      application_url: r.application_url,
      how_to_apply: r.how_to_apply,
      required_documents: parse(r.required_documents),
      publication_status: r.publication_status,
      lifecycle_status: r.lifecycle_status,
      verification_state: r.verification_state,
      published_at: r.published_at ? r.published_at.toISOString() : null,
      updated_at: r.updated_at.toISOString(),
      requirements: reqs.map((q) => ({
        id: String(q.id),
        rule_type: q.rule_type,
        necessity: q.necessity,
        params: parse<Record<string, unknown>>(q.params) ?? {},
        text: q.source_text,
        verified: q.verification_state === 'verified',
      })),
    };
  }

  private async staffSourceId(tx: Executor): Promise<string> {
    await tx.execute(
      `INSERT INTO opportunity_sources (name, type, access_status, ingestion_method)
       SELECT :n, 'editor_manual', 'manual_only', 'manual'
       WHERE NOT EXISTS (SELECT 1 FROM opportunity_sources WHERE name = :n)`,
      { n: STAFF_SOURCE },
    );
    const [s] = await tx.query<Row & { id: string }>(
      'SELECT id FROM opportunity_sources WHERE name = :n',
      {
        n: STAFF_SOURCE,
      },
    );
    return String(s!.id);
  }

  private async replaceRequirements(
    tx: Executor,
    oppId: string,
    reqs: NonNullable<AdminOpportunityInput['requirements']>,
  ): Promise<void> {
    await tx.execute('DELETE FROM opportunity_requirements WHERE opportunity_id = :id', {
      id: oppId,
    });
    let order = 0;
    for (const q of reqs) {
      await tx.execute(
        `INSERT INTO opportunity_requirements (opportunity_id, rule_type, necessity, params, source_text, machine_evaluable, verification_state, sort_order)
         VALUES (:o, :rt, :n, :p, :t, 1, 'unverified', :so)`,
        {
          o: oppId,
          rt: q.rule_type,
          n: q.necessity,
          p: JSON.stringify(q.params),
          t: q.text ?? null,
          so: order++,
        },
      );
    }
  }

  private async setLocation(
    tx: Executor,
    oppId: string,
    slug: string | null | undefined,
  ): Promise<void> {
    await tx.execute('DELETE FROM opportunity_locations WHERE opportunity_id = :id', { id: oppId });
    if (!slug) return;
    await tx.execute(
      `INSERT INTO opportunity_locations (opportunity_id, location_id)
       SELECT :id, id FROM locations WHERE slug = :s`,
      { id: oppId, s: slug },
    );
  }

  /** Creates a draft opportunity with its circular. */
  async create(
    input: AdminOpportunityInput,
    actor: { id: string; role: string },
    requestId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [cat] = await tx.query<Row & { id: string }>(
        'SELECT id FROM opportunity_categories WHERE slug = :s',
        {
          s: input.category_slug,
        },
      );
      if (!cat) return 'bad_category' as const;
      const [org] = await tx.query<Row & { id: string }>(
        'SELECT id FROM organizations WHERE id = :id',
        {
          id: input.organization_id,
        },
      );
      if (!org) return 'bad_organization' as const;
      const sourceId = await this.staffSourceId(tx);
      const circ = await tx.execute(
        `INSERT INTO circulars (organization_id, title, language, primary_source_id, official_url, verification_state, created_by)
         VALUES (:org, :t, 'bn', :src, :url, 'source_attributed', :by)`,
        {
          org: input.organization_id,
          t: input.title,
          src: sourceId,
          url: input.official_url ?? null,
          by: actor.id,
        },
      );
      const base = slugify(input.title_alt ?? input.title) || 'opportunity';
      const slug = `${base}-${randomBytes(4).toString('hex')}`.slice(0, 200);
      const opp = await tx.execute(
        `INSERT INTO opportunities (circular_id, organization_id, category_id, slug, title, title_alt, position_title,
           summary_bn, summary_en, vacancies, deadline_at, deadline_precision, application_url, how_to_apply,
           required_documents, publication_status, lifecycle_status)
         VALUES (:c, :org, :cat, :slug, :t, :ta, :pos, :sbn, :sen, :vac, :dl, 'date', :au, :how, :docs, 'draft', 'open')`,
        {
          c: String(circ.insertId),
          org: input.organization_id,
          cat: String(cat.id),
          slug,
          t: input.title,
          ta: input.title_alt ?? null,
          pos: input.position_title ?? null,
          sbn: input.summary_bn ?? null,
          sen: input.summary_en ?? null,
          vac: input.vacancies ?? null,
          dl: input.deadline_at ?? null,
          au: input.application_url ?? null,
          how: input.how_to_apply ?? null,
          docs: input.required_documents ? JSON.stringify(input.required_documents) : null,
        },
      );
      const id = String(opp.insertId);
      await this.setLocation(tx, id, input.location_slug);
      if (input.requirements) await this.replaceRequirements(tx, id, input.requirements);
      await this.audit(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'opportunity.create',
        targetType: 'opportunity',
        targetId: id,
        requestId,
      });
      return { id };
    });
  }

  /** Optimistic update: `expectedUpdatedAt` must match, otherwise another editor changed it. */
  async update(
    id: string,
    patch: Partial<AdminOpportunityInput>,
    expectedUpdatedAt: string,
    actor: { id: string; role: string },
    requestId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<Row & { updated_at: Date; circular_id: string }>(
        'SELECT updated_at, circular_id FROM opportunities WHERE id = :id FOR UPDATE',
        { id },
      );
      const cur = rows[0];
      if (!cur) return 'not_found' as const;
      if (cur.updated_at.toISOString() !== expectedUpdatedAt) return 'conflict' as const;
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      const map: Array<[keyof AdminOpportunityInput, string, (v: never) => unknown]> = [
        ['title', 'title', (v) => v],
        ['title_alt', 'title_alt', (v) => v],
        ['position_title', 'position_title', (v) => v],
        ['summary_bn', 'summary_bn', (v) => v],
        ['summary_en', 'summary_en', (v) => v],
        ['vacancies', 'vacancies', (v) => v],
        ['deadline_at', 'deadline_at', (v) => v],
        ['application_url', 'application_url', (v) => v],
        ['how_to_apply', 'how_to_apply', (v) => v],
        ['required_documents', 'required_documents', (v) => (v ? JSON.stringify(v) : null)],
      ];
      for (const [k, col, conv] of map) {
        if (patch[k] === undefined) continue;
        sets.push(`${col} = :${col}`);
        params[col] = conv(patch[k] as never);
      }
      if (patch.category_slug) {
        const [cat] = await tx.query<Row & { id: string }>(
          'SELECT id FROM opportunity_categories WHERE slug = :s',
          {
            s: patch.category_slug,
          },
        );
        if (!cat) return 'bad_category' as const;
        sets.push('category_id = :cat');
        params.cat = String(cat.id);
      }
      if (patch.organization_id) {
        sets.push('organization_id = :org');
        params.org = patch.organization_id;
      }
      if (sets.length > 0) {
        await tx.execute(
          `UPDATE opportunities SET ${sets.join(', ')}, current_version = current_version + 1 WHERE id = :id`,
          params,
        );
      }
      if (patch.official_url !== undefined) {
        await tx.execute('UPDATE circulars SET official_url = :u WHERE id = :c', {
          u: patch.official_url,
          c: String(cur.circular_id),
        });
      }
      if (patch.location_slug !== undefined) await this.setLocation(tx, id, patch.location_slug);
      if (patch.requirements) await this.replaceRequirements(tx, id, patch.requirements);
      await this.audit(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'opportunity.update',
        targetType: 'opportunity',
        targetId: id,
        metadata: { fields: Object.keys(patch) },
        requestId,
      });
      return 'ok' as const;
    });
  }

  /**
   * Publication workflow. Publishing needs an official source link (the "verified against the official circular"
   * claim) and a title, organisation and category; it stamps `published_at`, marks the circular verified and
   * rebuilds the search row.
   */
  async setPublication(
    id: string,
    to: 'published' | 'unpublished' | 'removed',
    actor: { id: string; role: string },
    requestId: string,
    reason?: string,
  ): Promise<'ok' | 'not_found' | 'needs_official_url' | 'needs_requirements_verified'> {
    const result = await this.db.transaction(async (tx) => {
      const rows = await tx.query<
        Row & { circular_id: string; official_url: string | null; publication_status: string }
      >(
        `SELECT o.circular_id, ci.official_url, o.publication_status
         FROM opportunities o JOIN circulars ci ON ci.id = o.circular_id WHERE o.id = :id FOR UPDATE`,
        { id },
      );
      const cur = rows[0];
      if (!cur) return 'not_found' as const;
      if (to === 'published') {
        if (!cur.official_url) return 'needs_official_url' as const;
        await tx.execute(
          `UPDATE opportunity_requirements SET verification_state = 'verified' WHERE opportunity_id = :id`,
          { id },
        );
        await tx.execute(
          `UPDATE circulars SET verification_state = 'verified_official', verified_by = :by, verified_at = NOW(3) WHERE id = :c`,
          { by: actor.id, c: String(cur.circular_id) },
        );
        await tx.execute(
          `UPDATE opportunities SET publication_status = 'published', published_at = COALESCE(published_at, NOW(3)) WHERE id = :id`,
          { id },
        );
      } else {
        await tx.execute('UPDATE opportunities SET publication_status = :to WHERE id = :id', {
          id,
          to,
        });
      }
      await this.audit(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: `opportunity.${to === 'published' ? 'publish' : to === 'unpublished' ? 'unpublish' : 'remove'}`,
        targetType: 'opportunity',
        targetId: id,
        ...(reason ? { reason } : {}),
        requestId,
      });
      return 'ok' as const;
    });
    if (result === 'ok') await this.opps.reindex(id);
    return result;
  }

  // ---- users and roles ----
  async listUsers(q: string | undefined, limit: number, offset: number) {
    const rows = await this.db.query<
      Row & {
        id: string;
        email: string;
        display_name: string;
        status: string;
        created_at: Date;
        last_login_at: Date | null;
      }
    >(
      `SELECT id, email, display_name, status, created_at, last_login_at FROM users
       ${q ? 'WHERE email_normalized LIKE :q OR display_name LIKE :q' : ''}
       ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
      { q: `%${(q ?? '').toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`, limit, offset },
    );
    const ids = rows.map((r) => String(r.id));
    const roles = ids.length
      ? await this.db.query<Row & { user_id: string; role: Role }>(
          'SELECT user_id, role FROM user_roles WHERE user_id IN (:ids)',
          { ids },
        )
      : [];
    return rows.map((r) => ({
      id: String(r.id),
      email: r.email,
      display_name: r.display_name,
      status: r.status,
      created_at: r.created_at.toISOString(),
      last_login_at: r.last_login_at ? r.last_login_at.toISOString() : null,
      roles: roles.filter((x) => String(x.user_id) === String(r.id)).map((x) => x.role),
    }));
  }

  /** Replaces a user's roles (`user` is always kept) and revokes their sessions so the change applies at once. */
  async setRoles(
    userId: string,
    roles: Role[],
    actor: { id: string; role: string },
    requestId: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [u] = await tx.query<Row & { id: string }>('SELECT id FROM users WHERE id = :id', {
        id: userId,
      });
      if (!u) return false;
      const wanted = new Set<Role>(['user', ...roles]);
      await tx.execute('DELETE FROM user_roles WHERE user_id = :id', { id: userId });
      for (const r of wanted) {
        await tx.execute(
          'INSERT INTO user_roles (user_id, role, granted_by) VALUES (:id, :r, :by)',
          {
            id: userId,
            r,
            by: actor.id,
          },
        );
      }
      await tx.execute('DELETE FROM user_sessions WHERE user_id = :id', { id: userId });
      await this.audit(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'user.set_roles',
        targetType: 'user',
        targetId: userId,
        metadata: { roles: [...wanted] },
        requestId,
      });
      return true;
    });
  }

  async auditLogs(limit: number, offset: number) {
    const rows = await this.db.query<
      Row & {
        id: string;
        actor_id: string | null;
        actor_role: string | null;
        action: string;
        target_type: string | null;
        target_id: string | null;
        reason: string | null;
        created_at: Date;
      }
    >(
      `SELECT id, actor_id, actor_role, action, target_type, target_id, reason, created_at
       FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset`,
      { limit, offset },
    );
    return rows.map((r) => ({
      id: String(r.id),
      actor_id: r.actor_id === null ? null : String(r.actor_id),
      actor_role: r.actor_role,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id === null ? null : String(r.target_id),
      reason: r.reason,
      at: r.created_at.toISOString(),
    }));
  }
}
