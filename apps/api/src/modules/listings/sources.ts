/**
 * Job feed connectors (plan v1.2 section 2). Only fixed, documented endpoints are called (no user-supplied URLs, so
 * no SSRF). Each connector returns short listings: title, company, place, a plain-text snippet and the original link.
 */
export interface FoundListing {
  external_id: string;
  title: string;
  company: string | null;
  location: string | null;
  snippet: string | null;
  url: string;
  tags: string[];
  posted_at: Date | null;
}

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface Connector {
  id: 'arbeitnow' | 'remotive' | 'google';
  label: string;
  homepage: string;
  /** What the owner must provide before it runs, or null when it needs nothing. */
  needs: string | null;
  enabled: boolean;
  fetch(f: FetchFn): Promise<FoundListing[]>;
}

const NAMED: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** HTML to short plain text. The snippet is a teaser, never the whole description. */
export function cleanSnippet(html: unknown, max = 500): string | null {
  if (typeof html !== 'string') return null;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => NAMED[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function httpUrlOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 1000) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const tagList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((t): t is string => typeof t === 'string')
        .slice(0, 8)
        .map((t) => t.slice(0, 40))
    : [];

export function parseArbeitnow(body: unknown): FoundListing[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: FoundListing[] = [];
  for (const j of data as Array<Record<string, unknown>>) {
    const url = httpUrlOrNull(j.url);
    const title = str(j.title, 400);
    const id = str(j.slug, 190);
    if (!url || !title || !id) continue;
    const created = typeof j.created_at === 'number' ? new Date(j.created_at * 1000) : null;
    out.push({
      external_id: id,
      title,
      company: str(j.company_name, 250),
      location: str(j.location, 250) ?? (j.remote === true ? 'Remote' : null),
      snippet: cleanSnippet(j.description),
      url,
      tags: tagList(j.tags),
      posted_at: created && !Number.isNaN(created.getTime()) ? created : null,
    });
  }
  return out;
}

export function parseRemotive(body: unknown): FoundListing[] {
  const jobs = (body as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: FoundListing[] = [];
  for (const j of jobs as Array<Record<string, unknown>>) {
    const url = httpUrlOrNull(j.url);
    const title = str(j.title, 400);
    const id = j.id !== undefined && j.id !== null ? String(j.id).slice(0, 190) : null;
    if (!url || !title || !id) continue;
    const posted = typeof j.publication_date === 'string' ? new Date(j.publication_date) : null;
    out.push({
      external_id: id,
      title,
      company: str(j.company_name, 250),
      location: str(j.candidate_required_location, 250) ?? 'Remote',
      snippet: cleanSnippet(j.description),
      url,
      tags: [...tagList(j.tags), ...(str(j.category, 40) ? [str(j.category, 40)!] : [])].slice(
        0,
        8,
      ),
      posted_at: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    });
  }
  return out;
}

export function parseGoogle(body: unknown): FoundListing[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: FoundListing[] = [];
  for (const j of items as Array<Record<string, unknown>>) {
    const url = httpUrlOrNull(j.link);
    const title = str(j.title, 400);
    if (!url || !title) continue;
    out.push({
      external_id: url.slice(0, 190),
      title,
      company: str(j.displayLink, 250),
      location: null,
      snippet: cleanSnippet(j.snippet),
      url,
      tags: [],
      posted_at: null,
    });
  }
  return out;
}

async function getJson(f: FetchFn, url: string): Promise<unknown> {
  const res = await f(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > 8_000_000) throw new Error('Response too large');
  return res.json();
}

export interface SourceConfig {
  googleKey?: string | undefined;
  googleCx?: string | undefined;
  googleQuery?: string | undefined;
}

export function buildConnectors(cfg: SourceConfig = {}): Connector[] {
  const googleReady = Boolean(cfg.googleKey && cfg.googleCx);
  return [
    {
      id: 'arbeitnow',
      label: 'Arbeitnow',
      homepage: 'https://www.arbeitnow.com',
      needs: null,
      enabled: true,
      fetch: async (f) =>
        parseArbeitnow(await getJson(f, 'https://www.arbeitnow.com/api/job-board-api')),
    },
    {
      id: 'remotive',
      label: 'Remotive',
      homepage: 'https://remotive.com',
      needs: null,
      enabled: true,
      fetch: async (f) =>
        parseRemotive(await getJson(f, 'https://remotive.com/api/remote-jobs?limit=60')),
    },
    {
      id: 'google',
      label: 'Google Search',
      homepage: 'https://programmablesearchengine.google.com',
      needs: 'GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX',
      enabled: googleReady,
      fetch: async (f) => {
        const q = encodeURIComponent(cfg.googleQuery ?? 'jobs in Bangladesh');
        const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
          cfg.googleKey ?? '',
        )}&cx=${encodeURIComponent(cfg.googleCx ?? '')}&q=${q}&num=10`;
        return parseGoogle(await getJson(f, url));
      },
    },
  ];
}
