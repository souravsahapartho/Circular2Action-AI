import type { Db, Row } from '../../db/pool';
import type { Clock } from '../../platform/clock';
import {
  classifyListing,
  priorityOf,
  regionOf,
  cleanDescription,
  GREENHOUSE_BOARDS,
  type Connector,
  type FetchFn,
  type FoundListing,
} from './sources';

export interface ListingRow {
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
  fetched_at: string;
  hidden: boolean;
}

interface DbListing extends Row {
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
  fetched_at: Date;
  hidden: number;
}

const toRow = (r: DbListing): ListingRow => ({
  id: String(r.id),
  source: r.source,
  title: r.title,
  company: r.company,
  location: r.location,
  snippet: r.snippet,
  url: r.url,
  tags: (typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags) ?? [],
  category_slug: r.category_slug,
  region: r.region,
  priority: Number(r.priority ?? 0),
  posted_at: r.posted_at ? r.posted_at.toISOString() : null,
  fetched_at: r.fetched_at.toISOString(),
  hidden: Number(r.hidden) === 1,
});

const COLUMNS =
  'id, source, title, company, location, snippet, url, tags, category_slug, region, priority, posted_at, fetched_at, hidden';
const STALE_MS = 6 * 60 * 60 * 1000;
/** Bangladeshi listings come first: about three in four. The rest are foreign ones. */
export const BD_SHARE = 0.75;
const BD_PATTERN = 3;

/** Interleaves two lists: `every` from the first, then one from the second. Whatever is left of either is appended. */
export function mixRegions<T>(first: T[], second: T[], every = 3): T[] {
  const out: T[] = [];
  let a = 0;
  let b = 0;
  while (a < first.length || b < second.length) {
    for (let i = 0; i < every && a < first.length; i++) out.push(first[a++]!);
    if (b < second.length) out.push(second[b++]!);
    else if (a >= first.length) break;
  }
  return out;
}

/** Cache of jobs found on the web: upsert from connectors, read for the site and the staff portal. */
export class ListingRepo {
  private refreshing: Promise<unknown> | null = null;

  constructor(
    private readonly db: Db,
    private readonly connectors: Connector[],
    private readonly clock: Clock,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
  ) {}

  async audit(e: {
    actorId: string;
    actorRole: string;
    action: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    requestId?: string;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, request_id)
       VALUES (:a, :r, :act, 'external_listing', :ti, :meta, :req)`,
      {
        a: e.actorId,
        r: e.actorRole.slice(0, 32),
        act: e.action,
        ti: e.targetId ?? null,
        meta: e.metadata ? JSON.stringify(e.metadata) : null,
        req: e.requestId?.slice(0, 40) ?? null,
      },
    );
  }

  async upsert(source: string, items: FoundListing[]): Promise<number> {
    if (items.length === 0) return 0;
    const now = this.clock.now();
    // one multi-row statement keeps a refresh to a few round trips on a remote database
    for (let i = 0; i < items.length; i += 50) {
      const chunk = items.slice(i, i + 50);
      const values: unknown[] = [];
      const marks = chunk
        .map((l) => {
          values.push(
            source,
            l.external_id,
            l.title,
            l.company,
            l.location,
            l.snippet,
            l.url,
            JSON.stringify(l.tags),
            l.posted_at,
            now,
            l.description ?? null,
            classifyListing(l.title, l.tags),
            regionOf(source, l.url, l.location),
            priorityOf(l.company, l.location),
          );
          return '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        })
        .join(', ');
      await this.db.execute(
        `INSERT INTO external_listings (source, external_id, title, company, location, snippet, url, tags, posted_at, fetched_at, description, category_slug, region, priority)
         VALUES ${marks}
         ON DUPLICATE KEY UPDATE title = VALUES(title), company = VALUES(company), location = VALUES(location),
           snippet = VALUES(snippet), url = VALUES(url), tags = VALUES(tags), posted_at = VALUES(posted_at),
           fetched_at = VALUES(fetched_at), description = COALESCE(VALUES(description), description),
           category_slug = VALUES(category_slug), region = VALUES(region),
           priority = VALUES(priority)`,
        values,
      );
    }
    return items.length;
  }

  async refresh(
    only?: string,
  ): Promise<Array<{ source: string; ok: boolean; fetched: number; error?: string }>> {
    const results: Array<{ source: string; ok: boolean; fetched: number; error?: string }> = [];
    for (const c of this.connectors) {
      if (!c.enabled || (only && c.id !== only)) continue;
      const started = this.clock.now();
      const run = await this.db.execute(
        'INSERT INTO external_source_runs (source, started_at) VALUES (:s, :t)',
        { s: c.id, t: started },
      );
      try {
        const found = await c.fetch(this.fetchFn);
        const n = await this.upsert(c.id, found);
        await this.db.execute(
          'UPDATE external_source_runs SET ok = 1, fetched = :n, finished_at = :t WHERE id = :id',
          { n, t: this.clock.now(), id: String(run.insertId) },
        );
        results.push({ source: c.id, ok: true, fetched: n });
      } catch (err) {
        const msg = (err instanceof Error ? err.message : 'Failed').slice(0, 300);
        await this.db.execute(
          'UPDATE external_source_runs SET ok = 0, error = :e, finished_at = :t WHERE id = :id',
          { e: msg, t: this.clock.now(), id: String(run.insertId) },
        );
        results.push({ source: c.id, ok: false, fetched: 0, error: msg });
      }
    }
    return results;
  }

  /** Starts a refresh in the background when the cache is older than six hours. Never throws, never blocks a reader. */
  refreshIfStale(): void {
    if (this.refreshing) return;
    this.refreshing = this.isStale()
      .then((stale) => (stale ? this.refresh() : undefined))
      .catch(() => undefined)
      .finally(() => {
        this.refreshing = null;
      });
  }

  async isStale(): Promise<boolean> {
    const enabled = this.connectors.filter((c) => c.enabled).map((c) => c.id);
    if (enabled.length === 0) return false;
    const rows = await this.db.query<Row & { source: string; t: Date | null }>(
      'SELECT source, MAX(started_at) AS t FROM external_source_runs GROUP BY source',
    );
    const last = new Map(rows.map((r) => [r.source, r.t]));
    const now = this.clock.now().getTime();
    return enabled.some((id) => {
      const t = last.get(id);
      return !t || now - t.getTime() > STALE_MS;
    });
  }

  async list(q: {
    q?: string;
    source?: string;
    category?: string;
    limit: number;
    offset: number;
    includeHidden?: boolean;
  }) {
    const where: string[] = [q.includeHidden ? '1 = 1' : 'hidden = 0'];
    const params: Record<string, unknown> = { limit: q.limit, offset: q.offset };
    if (q.source) {
      where.push('source = :source');
      params.source = q.source;
    }
    if (q.category) {
      where.push('category_slug = :category');
      params.category = q.category;
    }
    if (q.q) {
      where.push(
        '(LOWER(title) LIKE :like OR LOWER(company) LIKE :like OR LOWER(snippet) LIKE :like OR LOWER(location) LIKE :like)',
      );
      params.like = `%${q.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    }
    const w = where.join(' AND ');
    const page = (extra: string, limit: number, offset: number, byPriority = false) =>
      this.db.query<DbListing>(
        `SELECT ${COLUMNS} FROM external_listings WHERE ${w}${extra}
         ORDER BY ${byPriority ? 'priority DESC, ' : ''}COALESCE(posted_at, fetched_at) DESC, id DESC LIMIT ${Math.max(0, Math.floor(limit))} OFFSET ${Math.max(0, Math.floor(offset))}`,
        params,
      );
    let rows: DbListing[];
    if (q.includeHidden || q.source) {
      rows = await page('', q.limit, q.offset);
    } else {
      // about three Bangladeshi listings to one foreign one, in that rhythm; the other side fills in when one runs out
      const nBd = Math.ceil(q.limit * BD_SHARE);
      const offBd = Math.floor(q.offset * BD_SHARE);
      const bd = await page(" AND region = 'bd'", nBd, offBd);
      const wantIntl = q.limit - bd.length;
      // foreign ones: United States, Canada, Australia, work open to anyone and large companies first
      const intl = await page(" AND region <> 'bd'", wantIntl, q.offset - offBd, true);
      rows = mixRegions(bd, intl, BD_PATTERN).slice(0, q.limit);
    }
    const [c] = await this.db.query<Row & { n: number }>(
      `SELECT COUNT(*) AS n FROM external_listings WHERE ${w}`,
      params,
    );
    return { items: rows.map(toRow), total: Number(c!.n) };
  }

  /** One visible listing with its full description, or null. Fetches a missing Greenhouse description once. */
  async get(id: string): Promise<(ListingRow & { description: string | null }) | null> {
    const read = () =>
      this.db.query<
        DbListing & {
          external_id: string;
          description: string | null;
          detail_fetched_at: Date | null;
        }
      >(
        `SELECT ${COLUMNS}, external_id, description, detail_fetched_at FROM external_listings WHERE id = :id AND hidden = 0`,
        { id },
      );
    let [r] = await read();
    if (!r) return null;
    if (r.description === null && r.source === 'greenhouse' && r.detail_fetched_at === null) {
      await this.ensureGreenhouse(r.external_id);
      [r] = await read();
      if (!r) return null;
    }
    return { ...toRow(r), description: r.description ?? null };
  }

  /** Reads the job page of one company board (fixed hosts and boards only) and stores the description. */
  private async ensureGreenhouse(externalId: string): Promise<void> {
    const m = /^([a-z0-9-]{2,40})-(\d{1,20})$/.exec(externalId);
    const known = m && GREENHOUSE_BOARDS.some(([b]) => b === m[1]);
    let description: string | null = null;
    if (m && known) {
      try {
        const res = await this.fetchFn(
          `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (res.ok) {
          const body = (await res.json()) as { content?: unknown };
          description = cleanDescription(body.content);
        }
      } catch {
        description = null;
      }
    }
    await this.db.execute(
      `UPDATE external_listings SET description = COALESCE(:d, description), detail_fetched_at = :now
       WHERE source = 'greenhouse' AND external_id = :e`,
      { d: description, now: this.clock.now(), e: externalId },
    );
  }

  async setHidden(id: string, hidden: boolean): Promise<boolean> {
    const res = await this.db.execute('UPDATE external_listings SET hidden = :h WHERE id = :id', {
      h: hidden ? 1 : 0,
      id,
    });
    return res.affectedRows > 0;
  }

  /** What each source is, whether it runs, when it last ran and how many visible listings it supplies. */
  async sources() {
    const runs = await this.db.query<
      Row & { source: string; started_at: Date; ok: number; fetched: number; error: string | null }
    >(
      `SELECT r.source, r.started_at, r.ok, r.fetched, r.error FROM external_source_runs r
       JOIN (SELECT source, MAX(started_at) AS t FROM external_source_runs GROUP BY source) m
         ON m.source = r.source AND m.t = r.started_at`,
    );
    const counts = await this.db.query<Row & { source: string; n: number }>(
      'SELECT source, COUNT(*) AS n FROM external_listings WHERE hidden = 0 GROUP BY source',
    );
    const lastBy = new Map(runs.map((r) => [r.source, r]));
    const countBy = new Map(counts.map((c) => [c.source, Number(c.n)]));
    return this.connectors.map((c) => {
      const r = lastBy.get(c.id);
      return {
        id: c.id,
        label: c.label,
        homepage: c.homepage,
        enabled: c.enabled,
        needs: c.enabled ? null : c.needs,
        listings: countBy.get(c.id) ?? 0,
        last_run: r
          ? {
              at: r.started_at.toISOString(),
              ok: Number(r.ok) === 1,
              fetched: Number(r.fetched),
              error: r.error,
            }
          : null,
      };
    });
  }
}
