import { mixRegions } from '../listings/repo';
import { createHash } from 'node:crypto';
import { evaluate, type Requirement } from '@c2a/eligibility';
import type { Db, Executor, Row } from '../../db/pool';
import type { Clock } from '../../platform/clock';
import type { MeRepo } from '../me/repo';
import type { Locale, OpportunityRepo } from '../opportunities/repo';
import {
  buildAffinity,
  EMPTY_PREFERENCES,
  NOTIFY_THRESHOLD,
  rank,
  scoreWebJob,
  tokenize,
  WINDOW_DAYS,
  type Affinity,
  type Candidate,
  type InteractionKind,
  type InteractionRow,
  type Preferences,
  type Reason,
} from './score';

const dedupe = (...parts: Array<string | number>) =>
  createHash('sha256').update(parts.join('|')).digest();

const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

const cleanList = (xs: string[], max: number, len: number) =>
  [...new Set(xs.map((x) => x.trim().toLowerCase().slice(0, len)).filter(Boolean))].slice(0, max);

export interface RecommendedOpportunity {
  id: string;
  slug: string;
  title: string;
  organization: string;
  location: string | null;
  deadline_at: string | null;
  category: string;
  category_slug: string;
  closed: boolean;
  score: number;
  reasons: Reason[];
}

export interface RecommendedWebJob {
  id: string;
  source: string;
  title: string;
  company: string | null;
  location: string | null;
  snippet: string | null;
  url: string;
  tags: string[];
  category_slug: string;
  region: string;
  priority: number;
  posted_at: string | null;
  score: number;
  reasons: Reason[];
}

export interface NotificationItem {
  id: string;
  type: string;
  subject_type: string | null;
  subject_id: string | null;
  params: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

interface OppRow extends Row {
  id: string;
  slug: string;
  title: string;
  title_alt: string | null;
  summary_en: string | null;
  summary_bn: string | null;
  deadline_at: Date | null;
  published_at: Date | null;
  cat: string;
  loc: string | null;
}

const MATCH_THROTTLE_MS = 10 * 60 * 1000;
const NEW_PER_REFRESH = 5;

/** Preferences, activity, suggestions and notifications (plan v1.3). Every query is scoped to one user. */
export class RecommendService {
  constructor(
    private readonly db: Db,
    private readonly me: MeRepo,
    private readonly opportunities: OpportunityRepo,
    private readonly clock: Clock,
  ) {}

  // ---- preferences and activity ----

  async getPreferences(userId: string): Promise<Preferences> {
    const [r] = await this.db.query<
      Row & {
        categories: unknown;
        keywords: unknown;
        location_slugs: unknown;
        alerts_enabled: number;
        personalize: number;
      }
    >(
      'SELECT categories, keywords, location_slugs, alerts_enabled, personalize FROM job_preferences WHERE user_id = :u',
      {
        u: userId,
      },
    );
    if (!r) return { ...EMPTY_PREFERENCES };
    return {
      categories: json<string[]>(r.categories, []),
      keywords: json<string[]>(r.keywords, []),
      location_slugs: json<string[]>(r.location_slugs, []),
      alerts_enabled: Number(r.alerts_enabled) === 1,
      personalize: Number(r.personalize) === 1,
    };
  }

  async setPreferences(userId: string, p: Preferences): Promise<Preferences> {
    const clean: Preferences = {
      categories: cleanList(p.categories, 10, 100),
      keywords: cleanList(p.keywords, 15, 40),
      location_slugs: cleanList(p.location_slugs, 10, 120),
      alerts_enabled: p.alerts_enabled,
      personalize: p.personalize,
    };
    await this.db.execute(
      `INSERT INTO job_preferences (user_id, categories, keywords, location_slugs, alerts_enabled, personalize)
       VALUES (:u, :c, :k, :l, :a, :p)
       ON DUPLICATE KEY UPDATE categories = VALUES(categories), keywords = VALUES(keywords),
         location_slugs = VALUES(location_slugs), alerts_enabled = VALUES(alerts_enabled), personalize = VALUES(personalize),
         last_matched_at = NULL`,
      {
        u: userId,
        c: JSON.stringify(clean.categories),
        k: JSON.stringify(clean.keywords),
        l: JSON.stringify(clean.location_slugs),
        a: clean.alerts_enabled ? 1 : 0,
        p: clean.personalize ? 1 : 0,
      },
    );
    return clean;
  }

  async clearActivity(userId: string): Promise<number> {
    const res = await this.db.execute('DELETE FROM interaction_events WHERE user_id = :u', {
      u: userId,
    });
    return res.affectedRows;
  }

  async activityCount(userId: string): Promise<number> {
    const [r] = await this.db.query<Row & { n: number }>(
      'SELECT COUNT(*) AS n FROM interaction_events WHERE user_id = :u',
      { u: userId },
    );
    return Number(r!.n);
  }

  /**
   * Records one piece of activity. Does nothing when the person switched personalisation off. A repeated view of the
   * same opportunity within ten minutes is not counted again.
   */
  async record(
    userId: string,
    e: { kind: InteractionKind; opportunityId?: string; listingId?: string; term?: string },
    tx?: Executor,
  ): Promise<boolean> {
    const db = tx ?? this.db;
    const prefs = await this.getPreferences(userId);
    if (!prefs.personalize) return false;
    const now = this.clock.now();
    let category: string | null = null;
    let location: string | null = null;
    let term: string | null = e.term ? e.term.trim().toLowerCase().slice(0, 200) : null;
    if (e.opportunityId) {
      const [o] = await db.query<
        Row & { title: string; title_alt: string | null; cat: string; loc: string | null }
      >(
        `SELECT o.title, o.title_alt, c.slug AS cat,
                (SELECT l.slug FROM opportunity_locations ol JOIN locations l ON l.id = ol.location_id
                   WHERE ol.opportunity_id = o.id ORDER BY l.id LIMIT 1) AS loc
         FROM opportunities o JOIN opportunity_categories c ON c.id = o.category_id
         WHERE o.id = :id AND o.publication_status = 'published'`,
        { id: e.opportunityId },
      );
      if (!o) return false;
      category = o.cat;
      location = o.loc;
      term = `${o.title} ${o.title_alt ?? ''}`.trim().toLowerCase().slice(0, 200);
      if (e.kind === 'view') {
        const [recent] = await db.query<Row & { n: number }>(
          `SELECT COUNT(*) AS n FROM interaction_events
           WHERE user_id = :u AND kind = 'view' AND opportunity_id = :o AND created_at > :since`,
          { u: userId, o: e.opportunityId, since: new Date(now.getTime() - 10 * 60 * 1000) },
        );
        if (Number(recent!.n) > 0) return false;
      }
    } else if (e.listingId) {
      const [l] = await db.query<Row & { title: string; snippet: string | null }>(
        'SELECT title, snippet FROM external_listings WHERE id = :id',
        { id: e.listingId },
      );
      if (!l) return false;
      term = l.title.toLowerCase().slice(0, 200);
    } else if (!term) {
      return false;
    }
    await db.execute(
      `INSERT INTO interaction_events (user_id, kind, opportunity_id, listing_id, category_slug, location_slug, term, created_at)
       VALUES (:u, :k, :o, :l, :c, :loc, :t, :now)`,
      {
        u: userId,
        k: e.kind,
        o: e.opportunityId ?? null,
        l: e.listingId ?? null,
        c: category,
        loc: location,
        t: term,
        now,
      },
    );
    return true;
  }

  private async events(userId: string, now: Date): Promise<InteractionRow[]> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const rows = await this.db.query<
      Row & {
        kind: InteractionKind;
        category_slug: string | null;
        location_slug: string | null;
        term: string | null;
        created_at: Date;
      }
    >(
      `SELECT kind, category_slug, location_slug, term, created_at FROM interaction_events
       WHERE user_id = :u AND created_at > :since ORDER BY created_at DESC LIMIT 1000`,
      { u: userId, since },
    );
    return rows.map((r) => ({
      kind: r.kind,
      category_slug: r.category_slug,
      location_slug: r.location_slug,
      term: r.term,
      at: r.created_at,
    }));
  }

  // ---- candidates ----

  private async candidates(now: Date, limit = 300, onlyIds?: string[]): Promise<OppRow[]> {
    if (onlyIds && onlyIds.length === 0) return [];
    return this.db.query<OppRow>(
      `SELECT o.id, o.slug, o.title, o.title_alt, o.summary_en, o.summary_bn, o.deadline_at, o.published_at,
              c.slug AS cat,
              (SELECT l.slug FROM opportunity_locations ol JOIN locations l ON l.id = ol.location_id
                 WHERE ol.opportunity_id = o.id ORDER BY l.id LIMIT 1) AS loc
       FROM opportunities o JOIN opportunity_categories c ON c.id = o.category_id
       WHERE o.publication_status = 'published' AND o.lifecycle_status = 'open'
         AND (o.deadline_at IS NULL OR o.deadline_at > :now)
         ${onlyIds ? 'AND o.id IN (:ids)' : ''}
       ORDER BY COALESCE(o.deadline_at, '9999-12-31'), o.id LIMIT :limit`,
      { now, limit, ...(onlyIds ? { ids: onlyIds } : {}) },
    );
  }

  private async requirementsFor(ids: string[]): Promise<Map<string, Requirement[]>> {
    const out = new Map<string, Requirement[]>();
    if (ids.length === 0) return out;
    const rows = await this.db.query<
      Row & {
        id: string;
        opportunity_id: string;
        rule_type: string;
        necessity: string;
        group_key: string;
        branch_key: string;
        params: unknown;
        machine_evaluable: number;
        verification_state: string;
        source_text: string | null;
      }
    >(
      `SELECT id, opportunity_id, rule_type, necessity, group_key, branch_key, params, machine_evaluable,
              verification_state, source_text
       FROM opportunity_requirements WHERE opportunity_id IN (:ids)`,
      { ids },
    );
    for (const r of rows) {
      const list = out.get(String(r.opportunity_id)) ?? [];
      list.push({
        id: String(r.id),
        ruleType: r.rule_type as Requirement['ruleType'],
        necessity: r.necessity as Requirement['necessity'],
        groupKey: r.group_key,
        branchKey: r.branch_key,
        params: json<Record<string, unknown>>(r.params, {}),
        machineEvaluable: Number(r.machine_evaluable) === 1,
        verified: r.verification_state === 'verified',
        ...(r.source_text ? { sourceText: r.source_text } : {}),
      });
      out.set(String(r.opportunity_id), list);
    }
    return out;
  }

  private async excludedIds(userId: string): Promise<Set<string>> {
    const rows = await this.db.query<Row & { id: string }>(
      `SELECT opportunity_id AS id FROM saved_opportunities WHERE user_id = :u
       UNION SELECT opportunity_id AS id FROM application_records WHERE user_id = :u AND opportunity_id IS NOT NULL
       UNION SELECT opportunity_id AS id FROM site_applications WHERE user_id = :u`,
      { u: userId },
    );
    return new Set(rows.map((r) => String(r.id)));
  }

  private async scoredFor(
    userId: string,
    now: Date,
    opts: { exclude: boolean; limit?: number; ids?: string[] },
  ) {
    const [prefs, events, profile, cands] = await Promise.all([
      this.getPreferences(userId),
      this.events(userId, now),
      this.me.eligibilityProfile(userId),
      this.candidates(now, opts.limit ?? 300, opts.ids),
    ]);
    const affinity: Affinity | null = prefs.personalize ? buildAffinity(events, now) : null;
    const excluded = opts.exclude ? await this.excludedIds(userId) : new Set<string>();
    const pool = cands.filter((c) => !excluded.has(String(c.id)));
    const reqs = await this.requirementsFor(pool.map((c) => String(c.id)));
    const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(now);
    const candidates: Array<Candidate & { slug: string }> = pool.map((c) => {
      const rs = reqs.get(String(c.id)) ?? [];
      return {
        id: String(c.id),
        slug: c.slug,
        title: c.title,
        title_alt: c.title_alt,
        summary: c.summary_en ?? c.summary_bn,
        category_slug: c.cat,
        location_slug: c.loc,
        deadline_at: c.deadline_at,
        published_at: c.published_at,
        eligibility: rs.length > 0 ? evaluate(profile, rs, asOf).status : null,
      };
    });
    return { prefs, affinity, events, ranked: rank(candidates, prefs, affinity, now) };
  }

  /** How well each of these opportunities fits this person (used to pick which sponsored posts to show). */
  async scoreIds(userId: string, ids: string[]) {
    const { ranked } = await this.scoredFor(userId, this.clock.now(), {
      exclude: false,
      limit: Math.max(1, ids.length),
      ids,
    });
    return ranked;
  }

  /** "For you": opportunities ranked for this person, plus web jobs that match their interests. */
  async recommend(userId: string, locale: Locale, limit = 8) {
    const now = this.clock.now();
    const { prefs, affinity, events, ranked } = await this.scoredFor(userId, now, {
      exclude: true,
    });
    const top = ranked.filter((r) => r.eligibility !== 'not_eligible').slice(0, limit);
    const summaries = await this.opportunities.summaries(
      top.map((t) => t.id),
      locale,
      now,
    );
    const byId = new Map(summaries.map((s) => [s.id, s]));
    const opportunities: RecommendedOpportunity[] = top
      .map((t) => {
        const s = byId.get(t.id);
        return s ? { ...s, score: t.score, reasons: t.reasons } : null;
      })
      .filter((x): x is RecommendedOpportunity => x !== null);

    const webJobs = (await this.rankedWeb(prefs, affinity, now, {}))
      .filter((j) => j.reasons.some((x) => x.code === 'keyword'))
      .slice(0, 6);

    return {
      opportunities,
      web_jobs: webJobs,
      top_categories: this.topCategories(prefs, affinity),
      personalised:
        prefs.personalize &&
        (events.length > 0 || prefs.categories.length + prefs.keywords.length > 0),
      signals: {
        activity: events.length,
        categories: prefs.categories.length,
        keywords: prefs.keywords.length,
        personalize: prefs.personalize,
      },
    };
  }

  // ---- notifications ----

  private async insertNotification(
    tx: Executor,
    userId: string,
    type: string,
    subject: { type: string; id: string },
    key: string,
    params: Record<string, unknown>,
    now: Date,
  ): Promise<boolean> {
    const res = await tx.execute(
      `INSERT IGNORE INTO notifications (user_id, type, subject_type, subject_id, title_key, params, dedupe_key, created_at)
       VALUES (:u, :t, :st, :si, :tk, :p, :d, :now)`,
      {
        u: userId,
        t: type,
        st: subject.type,
        si: subject.id,
        tk: type,
        p: JSON.stringify(params),
        d: dedupe(userId, type, subject.type, subject.id, key),
        now,
      },
    );
    return res.affectedRows > 0;
  }

  /**
   * Creates the notifications a person is due: strong matches (when alerts are on) and deadline reminders for what
   * they saved or track. Throttled, deduplicated, at most a few new ones per call.
   */
  async refreshNotifications(userId: string, force = false): Promise<number> {
    const now = this.clock.now();
    const [meta] = await this.db.query<Row & { last_matched_at: Date | null }>(
      'SELECT last_matched_at FROM job_preferences WHERE user_id = :u',
      { u: userId },
    );
    if (
      !force &&
      meta?.last_matched_at &&
      now.getTime() - meta.last_matched_at.getTime() < MATCH_THROTTLE_MS
    ) {
      return 0;
    }
    const prefs = await this.getPreferences(userId);
    let created = 0;

    // deadline reminders: saved or tracked, closing within 72 hours
    const soon = new Date(now.getTime() + 72 * 3_600_000);
    const due = await this.db.query<
      Row & { id: string; title: string; title_alt: string | null; deadline_at: Date }
    >(
      `SELECT o.id, o.title, o.title_alt, o.deadline_at FROM opportunities o
       WHERE o.publication_status = 'published' AND o.deadline_at > :now AND o.deadline_at <= :soon
         AND (o.id IN (SELECT opportunity_id FROM saved_opportunities WHERE user_id = :u)
           OR o.id IN (SELECT opportunity_id FROM application_records
                       WHERE user_id = :u AND opportunity_id IS NOT NULL AND status IN ('interested', 'preparing'))) LIMIT 10`,
      { u: userId, now, soon },
    );
    for (const o of due) {
      const hours = (o.deadline_at.getTime() - now.getTime()) / 3_600_000;
      const slot = hours <= 24 ? '24h' : '72h';
      if (
        await this.insertNotification(
          this.db,
          userId,
          'deadline_reminder',
          { type: 'opportunity', id: String(o.id) },
          slot,
          {
            title: o.title,
            title_alt: o.title_alt,
            deadline_at: o.deadline_at.toISOString(),
            slot,
          },
          now,
        )
      ) {
        created++;
      }
    }

    if (prefs.alerts_enabled) {
      const { ranked } = await this.scoredFor(userId, now, { exclude: true, limit: 200 });
      let fresh = 0;
      for (const r of ranked) {
        if (r.score < NOTIFY_THRESHOLD || r.eligibility === 'not_eligible') break;
        if (fresh >= NEW_PER_REFRESH) break;
        const ok = await this.insertNotification(
          this.db,
          userId,
          'job_match',
          { type: 'opportunity', id: r.id },
          'match',
          { title: r.title, title_alt: r.title_alt ?? null, reasons: r.reasons, score: r.score },
          now,
        );
        if (ok) {
          fresh++;
          created++;
        }
      }
    }

    await this.db.execute(
      `INSERT INTO job_preferences (user_id, last_matched_at) VALUES (:u, :now)
       ON DUPLICATE KEY UPDATE last_matched_at = VALUES(last_matched_at)`,
      { u: userId, now },
    );
    return created;
  }

  /** When staff publish an opportunity: tell the people with alerts on whom it matches well. Returns how many were told. */
  async fanOut(opportunityId: string): Promise<number> {
    const now = this.clock.now();
    const [o] = await this.db.query<OppRow>(
      `SELECT o.id, o.slug, o.title, o.title_alt, o.summary_en, o.summary_bn, o.deadline_at, o.published_at,
              c.slug AS cat,
              (SELECT l.slug FROM opportunity_locations ol JOIN locations l ON l.id = ol.location_id
                 WHERE ol.opportunity_id = o.id ORDER BY l.id LIMIT 1) AS loc
       FROM opportunities o JOIN opportunity_categories c ON c.id = o.category_id
       WHERE o.id = :id AND o.publication_status = 'published' AND o.lifecycle_status = 'open'`,
      { id: opportunityId },
    );
    if (!o) return 0;
    const reqs = (await this.requirementsFor([String(o.id)])).get(String(o.id)) ?? [];
    const users = await this.db.query<Row & { user_id: string }>(
      `SELECT user_id FROM job_preferences WHERE alerts_enabled = 1 LIMIT 2000`,
    );
    const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(now);
    let told = 0;
    for (const u of users) {
      const userId = String(u.user_id);
      const [prefs, events, profile, excluded] = await Promise.all([
        this.getPreferences(userId),
        this.events(userId, now),
        this.me.eligibilityProfile(userId),
        this.excludedIds(userId),
      ]);
      if (excluded.has(String(o.id))) continue;
      const cand: Candidate = {
        id: String(o.id),
        title: o.title,
        title_alt: o.title_alt,
        summary: o.summary_en ?? o.summary_bn,
        category_slug: o.cat,
        location_slug: o.loc,
        deadline_at: o.deadline_at,
        published_at: o.published_at ?? now,
        eligibility: reqs.length > 0 ? evaluate(profile, reqs, asOf).status : null,
      };
      const [r] = rank([cand], prefs, prefs.personalize ? buildAffinity(events, now) : null, now);
      if (!r || r.score < NOTIFY_THRESHOLD || r.eligibility === 'not_eligible') continue;
      if (
        await this.insertNotification(
          this.db,
          userId,
          'job_match',
          { type: 'opportunity', id: String(o.id) },
          'match',
          { title: o.title, title_alt: o.title_alt, reasons: r.reasons, score: r.score },
          now,
        )
      ) {
        told++;
      }
    }
    return told;
  }

  async notifications(userId: string, opts: { limit: number; unreadOnly?: boolean }) {
    const rows = await this.db.query<
      Row & {
        id: string;
        type: string;
        subject_type: string | null;
        subject_id: string | null;
        params: unknown;
        read_at: Date | null;
        created_at: Date;
      }
    >(
      `SELECT id, type, subject_type, subject_id, params, read_at, created_at FROM notifications
       WHERE user_id = :u ${opts.unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC, id DESC LIMIT :limit`,
      { u: userId, limit: opts.limit },
    );
    const items: NotificationItem[] = rows.map((r) => ({
      id: String(r.id),
      type: r.type,
      subject_type: r.subject_type,
      subject_id: r.subject_id === null ? null : String(r.subject_id),
      params: json<Record<string, unknown>>(r.params, {}),
      read: r.read_at !== null,
      created_at: r.created_at.toISOString(),
    }));
    return { items, unread: await this.unreadCount(userId) };
  }

  async unreadCount(userId: string): Promise<number> {
    const [r] = await this.db.query<Row & { n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = :u AND read_at IS NULL',
      { u: userId },
    );
    return Number(r!.n);
  }

  async markRead(userId: string, ids: string[] | 'all'): Promise<number> {
    const now = this.clock.now();
    if (ids === 'all') {
      const res = await this.db.execute(
        'UPDATE notifications SET read_at = :now WHERE user_id = :u AND read_at IS NULL',
        { u: userId, now },
      );
      return res.affectedRows;
    }
    if (ids.length === 0) return 0;
    const res = await this.db.execute(
      'UPDATE notifications SET read_at = :now WHERE user_id = :u AND read_at IS NULL AND id IN (:ids)',
      { u: userId, now, ids },
    );
    return res.affectedRows;
  }

  /** Category slugs this person leans towards: their explicit choices first, then by activity. */
  topCategories(prefs: Preferences, affinity: Affinity | null): string[] {
    const fromActivity = affinity
      ? [...affinity.category.entries()].sort((x, y) => y[1] - x[1]).map(([slug]) => slug)
      : [];
    return [...new Set([...prefs.categories, ...fromActivity])].slice(0, 6);
  }

  /** Every visible web job scored for this person, best first (then newest). */
  private async rankedWeb(
    prefs: Preferences,
    affinity: Affinity | null,
    now: Date,
    f: { q?: string; source?: string; category?: string },
  ): Promise<RecommendedWebJob[]> {
    const where = ['hidden = 0'];
    if (f.category) {
      where.push('category_slug = :category');
    }
    const params: Record<string, unknown> = {};
    if (f.category) params.category = f.category;
    if (f.source) {
      where.push('source = :source');
      params.source = f.source;
    }
    if (f.q) {
      where.push(
        '(LOWER(title) LIKE :like OR LOWER(company) LIKE :like OR LOWER(snippet) LIKE :like OR LOWER(location) LIKE :like)',
      );
      params.like = `%${f.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    }
    const rows = await this.db.query<
      Row & {
        id: string;
        source: string;
        title: string;
        company: string | null;
        location: string | null;
        snippet: string | null;
        url: string;
        tags: unknown;
        category_slug: string;
        region: string;
        priority: number;
        posted_at: Date | null;
      }
    >(
      `SELECT id, source, title, company, location, snippet, url, tags, category_slug, region, priority, posted_at FROM external_listings
       WHERE ${where.join(' AND ')} ORDER BY COALESCE(posted_at, fetched_at) DESC LIMIT 1500`,
      params,
    );
    const interestWords = prefs.categories.flatMap((c) => tokenize(c.replace(/-/g, ' ')));
    const scored = rows
      .map((r) => {
        const tags = json<string[]>(r.tags, []);
        const sc = scoreWebJob(
          {
            id: String(r.id),
            title: r.title,
            company: r.company,
            location: r.location,
            snippet: r.snippet,
            tags,
            posted_at: r.posted_at,
          },
          prefs,
          affinity,
          now,
          interestWords,
        );
        return {
          id: String(r.id),
          source: r.source,
          title: r.title,
          company: r.company,
          location: r.location,
          snippet: r.snippet,
          url: r.url,
          tags,
          category_slug: r.category_slug,
          region: r.region,
          priority: Number(r.priority ?? 0),
          posted_at: r.posted_at ? r.posted_at.toISOString() : null,
          score: sc.score,
          reasons: sc.reasons,
        };
      })
      .sort((x, y) => y.score - x.score || (y.posted_at ?? '').localeCompare(x.posted_at ?? ''));
    // Bangladeshi listings first (about three in four), each side still in order of fit; then spread companies out
    const bd = scored.filter((x) => x.region === 'bd');
    // foreign ones lean to the United States, Canada, Australia, open-to-all work and big companies
    const foreign = scored
      .filter((x) => x.region !== 'bd')
      .sort((x, y) => y.score + y.priority * 1.5 - (x.score + x.priority * 1.5));
    return diversify(mixRegions(bd, foreign, 3));
  }

  /** The whole web jobs list ordered by relevance to this person (used by the web jobs page). */
  async webFeed(
    userId: string,
    f: { q?: string; source?: string; category?: string; limit: number; offset: number },
  ) {
    const now = this.clock.now();
    const prefs = await this.getPreferences(userId);
    const events = prefs.personalize ? await this.events(userId, now) : [];
    const affinity = prefs.personalize ? buildAffinity(events, now) : null;
    const ranked = await this.rankedWeb(prefs, affinity, now, {
      ...(f.q ? { q: f.q } : {}),
      ...(f.source ? { source: f.source } : {}),
      ...(f.category ? { category: f.category } : {}),
    });
    return {
      items: ranked.slice(f.offset, f.offset + f.limit),
      total: ranked.length,
      personalised: ranked.some((r) => r.reasons.some((x) => x.code === 'keyword')),
    };
  }

  /**
   * The explore list in "for you" order: every open opportunity (saved ones included) with its score and reasons,
   * filtered by category or place, paged.
   */
  async feed(
    userId: string,
    locale: Locale,
    f: { category?: string; location?: string; limit: number; offset: number },
  ) {
    const now = this.clock.now();
    const { prefs, events, ranked } = await this.scoredFor(userId, now, {
      exclude: false,
      limit: 500,
    });
    const list = ranked.filter(
      (r) =>
        (!f.category || r.category_slug === f.category) &&
        (!f.location || r.location_slug === f.location),
    );
    const page = list.slice(f.offset, f.offset + f.limit);
    const summaries = await this.opportunities.summaries(
      page.map((p) => p.id),
      locale,
      now,
    );
    const byId = new Map(summaries.map((x) => [x.id, x]));
    const items = page
      .map((p) => {
        const sm = byId.get(p.id);
        return sm ? { ...sm, score: p.score, reasons: p.reasons } : null;
      })
      .filter((x): x is RecommendedOpportunity => x !== null);
    return {
      items,
      total: list.length,
      personalised:
        prefs.personalize &&
        (events.length > 0 || prefs.categories.length + prefs.keywords.length > 0),
    };
  }

  /** Similar opportunities for a detail page: same kind and place, shared words in the title. Needs no account. */
  async similar(opportunityId: string, locale: Locale, limit = 4) {
    const now = this.clock.now();
    const [base] = await this.db.query<OppRow>(
      `SELECT o.id, o.slug, o.title, o.title_alt, o.summary_en, o.summary_bn, o.deadline_at, o.published_at,
              c.slug AS cat,
              (SELECT l.slug FROM opportunity_locations ol JOIN locations l ON l.id = ol.location_id
                 WHERE ol.opportunity_id = o.id ORDER BY l.id LIMIT 1) AS loc
       FROM opportunities o JOIN opportunity_categories c ON c.id = o.category_id
       WHERE o.id = :id AND o.publication_status = 'published'`,
      { id: opportunityId },
    );
    if (!base) return [];
    const words = new Set([...tokenize(base.title), ...tokenize(base.title_alt)]);
    const pool = (await this.candidates(now, 300)).filter((c) => String(c.id) !== String(base.id));
    const scored = pool
      .map((c) => {
        const overlap = [...new Set([...tokenize(c.title), ...tokenize(c.title_alt)])].filter((w) =>
          words.has(w),
        ).length;
        const score =
          (c.cat === base.cat ? 3 : 0) +
          (c.loc && c.loc === base.loc ? 1 : 0) +
          Math.min(3, overlap * 1.2);
        return { id: String(c.id), score, deadline: c.deadline_at };
      })
      .filter((x) => x.score >= 3)
      .sort(
        (x, y) =>
          y.score - x.score ||
          (x.deadline?.getTime() ?? Infinity) - (y.deadline?.getTime() ?? Infinity) ||
          x.id.localeCompare(y.id),
      )
      .slice(0, limit);
    return this.opportunities.summaries(
      scored.map((x) => x.id),
      locale,
      now,
    );
  }
}

/**
 * Keeps the order by relevance but stops one company or one source from filling a whole screen: when the next item
 * repeats a company seen in the last two picks (or a source seen in the last three), a close candidate that does not
 * repeat is taken first. Pure and stable; nothing is dropped.
 */
export function diversify<T extends { company: string | null; source: string }>(
  list: T[],
  window = 8,
): T[] {
  const rest = [...list];
  const out: T[] = [];
  const co = (x: T) => (x.company ?? '').toLowerCase();
  while (rest.length) {
    const recentCompanies = out.slice(-2).map(co);
    const recentSources = out.slice(-3).map((x) => x.source);
    const near = rest.slice(0, window);
    const newCompany = (x: T) => !co(x) || !recentCompanies.includes(co(x));
    let pick = near.findIndex((x) => newCompany(x) && !recentSources.includes(x.source));
    if (pick < 0) pick = near.findIndex(newCompany);
    if (pick < 0) pick = 0;
    out.push(rest.splice(pick, 1)[0]!);
  }
  return out;
}
