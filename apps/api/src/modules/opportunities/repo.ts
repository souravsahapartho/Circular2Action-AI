import { normalizeForMatch } from '@c2a/normalize';
import type { Db, Row } from '../../db/pool';

export type Locale = 'bn' | 'en';

export interface OpportunitySummary {
  id: string;
  slug: string;
  title: string;
  organization: string;
  location: string | null;
  deadline_at: string | null;
  category: string;
  category_slug: string;
}

export interface OpportunityDetail extends OpportunitySummary {
  summary: string | null;
  source_url: string | null;
  verified: boolean;
  positions: string | null;
  vacancies: number | null;
  application_url: string | null;
  how_to_apply: string | null;
  requirements: Array<{
    id: string;
    rule_type: string;
    necessity: string;
    group_key: string;
    branch_key: string;
    params: Record<string, unknown>;
    machine_evaluable: boolean;
    verified: boolean;
    text: string | null;
  }>;
}

export interface ListQuery {
  locale: Locale;
  category?: string;
  location?: string;
  sort?: 'deadline' | 'newest';
  q?: string;
  limit: number;
  offset: number;
  /** now, injected so tests control time (plan 19.9) */
  now: Date;
}

interface ListRow extends Row {
  id: string;
  slug: string;
  title: string;
  title_alt: string | null;
  deadline_at: Date | null;
  cat_en: string;
  cat_bn: string;
  cat_slug: string;
  org_en: string | null;
  org_bn: string | null;
  loc_en: string | null;
  loc_bn: string | null;
}

const BASE = `
  FROM opportunities o
  JOIN organizations org ON org.id = o.organization_id
  JOIN opportunity_categories c ON c.id = o.category_id
  LEFT JOIN opportunity_search s ON s.opportunity_id = o.id
  WHERE o.publication_status = 'published' AND o.lifecycle_status = 'open'
    AND (o.deadline_at IS NULL OR o.deadline_at > :now)`;

const SELECT = `
  SELECT o.id, o.slug, o.title, o.title_alt, o.deadline_at,
         c.name_en AS cat_en, c.name_bn AS cat_bn, c.slug AS cat_slug,
         org.name_en AS org_en, org.name_bn AS org_bn,
         (SELECT l.name_en FROM opportunity_locations ol JOIN locations l ON l.id = ol.location_id
            WHERE ol.opportunity_id = o.id ORDER BY l.id LIMIT 1) AS loc_en,
         (SELECT l.name_bn FROM opportunity_locations ol JOIN locations l ON l.id = ol.location_id
            WHERE ol.opportunity_id = o.id ORDER BY l.id LIMIT 1) AS loc_bn`;

/** Escapes LIKE wildcards so user input cannot widen a search. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function toSummary(r: ListRow, locale: Locale): OpportunitySummary {
  return {
    id: String(r.id),
    slug: r.slug,
    title: r.title,
    organization: (locale === 'bn' ? (r.org_bn ?? r.org_en) : (r.org_en ?? r.org_bn)) ?? '',
    location: (locale === 'bn' ? (r.loc_bn ?? r.loc_en) : (r.loc_en ?? r.loc_bn)) ?? null,
    deadline_at: r.deadline_at ? r.deadline_at.toISOString() : null,
    category: locale === 'bn' ? r.cat_bn : r.cat_en,
    category_slug: r.cat_slug,
  };
}

/**
 * Read side of the opportunity module. Only `published` and `open` rows are ever returned to the public.
 * Search is an interim LIKE over normalised text (ADR: gate S-1 has not chosen FULLTEXT or n-gram yet).
 */
export class OpportunityRepo {
  constructor(private readonly db: Db) {}

  async list(q: ListQuery): Promise<{ items: OpportunitySummary[]; total: number }> {
    const where: string[] = [];
    const params: Record<string, unknown> = { now: q.now, limit: q.limit, offset: q.offset };
    if (q.category) {
      where.push('c.slug = :cat');
      params.cat = q.category;
    }
    if (q.location) {
      where.push(
        'EXISTS (SELECT 1 FROM opportunity_locations ol2 JOIN locations l2 ON l2.id = ol2.location_id WHERE ol2.opportunity_id = o.id AND l2.slug = :loc)',
      );
      params.loc = q.location;
    }
    if (q.q !== undefined) {
      const norm = normalizeForMatch(q.q);
      // a query with no letters or digits (only punctuation or symbols) matches nothing
      if (!norm) return { items: [], total: 0 };
      const terms = norm.split(' ').slice(0, 6);
      terms.forEach((t, i) => {
        where.push(
          `(s.title LIKE :t${i} OR s.organization LIKE :t${i} OR s.position LIKE :t${i} OR s.body LIKE :t${i})`,
        );
        params[`t${i}`] = `%${likeEscape(t)}%`;
      });
    }
    const extra = where.length ? ` AND ${where.join(' AND ')}` : '';
    const rows = await this.db.query<ListRow>(
      `${SELECT} ${BASE}${extra}
       ORDER BY ${q.sort === 'newest' ? 'o.published_at DESC, o.id DESC' : '(o.deadline_at IS NULL), o.deadline_at, o.id'}
       LIMIT :limit OFFSET :offset`,
      params,
    );
    const [c] = await this.db.query<Row & { n: number }>(
      `SELECT COUNT(*) AS n ${BASE}${extra}`,
      params,
    );
    return { items: rows.map((r) => toSummary(r, q.locale)), total: Number(c!.n) };
  }

  async get(id: string, locale: Locale, now: Date): Promise<OpportunityDetail | null> {
    const rows = await this.db.query<
      ListRow & {
        summary_bn: string | null;
        summary_en: string | null;
        official_url: string | null;
        verification_state: string;
        position_title: string | null;
        vacancies: number | null;
        application_url: string | null;
        how_to_apply: string | null;
      }
    >(
      `${SELECT}, o.summary_bn, o.summary_en, o.position_title, o.vacancies, o.application_url, o.how_to_apply,
              ci.official_url, ci.verification_state
       ${BASE.replace('LEFT JOIN opportunity_search s ON s.opportunity_id = o.id', 'JOIN circulars ci ON ci.id = o.circular_id')}
         AND o.id = :id`,
      { id, now },
    );
    const r = rows[0];
    if (!r) return null;
    const reqs = await this.db.query<
      Row & {
        id: string;
        rule_type: string;
        necessity: string;
        group_key: string;
        branch_key: string;
        params: Record<string, unknown> | string;
        machine_evaluable: number;
        verification_state: string;
        source_text: string | null;
      }
    >(
      `SELECT id, rule_type, necessity, group_key, branch_key, params, machine_evaluable, verification_state, source_text
       FROM opportunity_requirements WHERE opportunity_id = :id ORDER BY necessity, sort_order, id`,
      { id },
    );
    const summary =
      locale === 'bn' ? (r.summary_bn ?? r.summary_en) : (r.summary_en ?? r.summary_bn);
    return {
      ...toSummary(r, locale),
      summary,
      source_url: r.official_url,
      verified: r.verification_state === 'verified_official',
      positions: r.position_title,
      vacancies: r.vacancies === null ? null : Number(r.vacancies),
      application_url: r.application_url,
      how_to_apply: r.how_to_apply,
      requirements: reqs.map((x) => ({
        id: String(x.id),
        rule_type: x.rule_type,
        necessity: x.necessity,
        group_key: x.group_key,
        branch_key: x.branch_key,
        params:
          typeof x.params === 'string'
            ? (JSON.parse(x.params) as Record<string, unknown>)
            : x.params,
        machine_evaluable: Number(x.machine_evaluable) === 1,
        verified: x.verification_state === 'verified',
        text: x.source_text,
      })),
    };
  }

  /** Summaries for specific ids (saved list), newest save order kept; unpublished ones are skipped. */
  async summaries(
    ids: string[],
    locale: Locale,
    now: Date,
  ): Promise<Array<OpportunitySummary & { closed: boolean }>> {
    if (ids.length === 0) return [];
    const rows = await this.db.query<ListRow>(
      `${SELECT}
       FROM opportunities o
       JOIN organizations org ON org.id = o.organization_id
       JOIN opportunity_categories c ON c.id = o.category_id
       WHERE o.publication_status = 'published' AND o.id IN (:ids)`,
      { ids },
    );
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is ListRow => r !== undefined)
      .map((r) => ({
        ...toSummary(r, locale),
        closed: r.deadline_at !== null && r.deadline_at <= now,
      }));
  }

  async categories(
    locale: Locale,
    now: Date,
  ): Promise<Array<{ slug: string; kind: string; name: string; count: number }>> {
    const rows = await this.db.query<
      Row & { slug: string; kind: string; name_en: string; name_bn: string; n: number }
    >(
      `SELECT c.slug, c.kind, c.name_en, c.name_bn,
              (SELECT COUNT(*) FROM opportunities o WHERE o.category_id = c.id AND o.publication_status = 'published'
                 AND o.lifecycle_status = 'open' AND (o.deadline_at IS NULL OR o.deadline_at > :now)) AS n
       FROM opportunity_categories c WHERE c.is_active = 1 ORDER BY c.sort_order, c.id`,
      { now },
    );
    return rows.map((r) => ({
      slug: r.slug,
      kind: r.kind,
      name: locale === 'bn' ? r.name_bn : r.name_en,
      count: Number(r.n),
    }));
  }

  async locations(
    locale: Locale,
  ): Promise<Array<{ id: string; slug: string; type: string; name: string }>> {
    const rows = await this.db.query<
      Row & { id: string; slug: string; type: string; name_en: string; name_bn: string | null }
    >(
      `SELECT id, slug, type, name_en, name_bn FROM locations WHERE type <> 'country' ORDER BY name_en`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      slug: r.slug,
      type: r.type,
      name: locale === 'bn' ? (r.name_bn ?? r.name_en) : r.name_en,
    }));
  }

  /** Rebuilds the search row for one opportunity from its source rows. */
  async reindex(opportunityId: string): Promise<void> {
    const [o] = await this.db.query<
      Row & {
        title: string;
        title_alt: string | null;
        position_title: string | null;
        sbn: string | null;
        sen: string | null;
        oen: string | null;
        obn: string | null;
      }
    >(
      `SELECT o.title, o.title_alt, o.position_title, o.summary_bn AS sbn, o.summary_en AS sen,
              org.name_en AS oen, org.name_bn AS obn
       FROM opportunities o JOIN organizations org ON org.id = o.organization_id WHERE o.id = :id`,
      { id: opportunityId },
    );
    if (!o) return;
    const n = (...v: Array<string | null>) => normalizeForMatch(v.filter(Boolean).join(' '));
    await this.db.execute(
      `INSERT INTO opportunity_search (opportunity_id, title, organization, position, skills, body)
       VALUES (:id, :t, :org, :pos, NULL, :body)
       ON DUPLICATE KEY UPDATE title = VALUES(title), organization = VALUES(organization),
         position = VALUES(position), body = VALUES(body)`,
      {
        id: opportunityId,
        t: n(o.title, o.title_alt).slice(0, 600),
        org: n(o.oen, o.obn).slice(0, 500),
        pos: n(o.position_title).slice(0, 300),
        body: n(o.sbn, o.sen),
      },
    );
  }
}
