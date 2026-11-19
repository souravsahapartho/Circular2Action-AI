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
  /** the whole description as clean plain text (paragraphs separated by blank lines), or null */
  description?: string | null;
  url: string;
  tags: string[];
  posted_at: Date | null;
}

export const SOURCE_IDS = [
  'arbeitnow',
  'remotive',
  'jobicy',
  'remoteok',
  'himalayas',
  'greenhouse',
  'lever',
  'google',
] as const;

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface Connector {
  id:
    | 'arbeitnow'
    | 'remotive'
    | 'jobicy'
    | 'remoteok'
    | 'himalayas'
    | 'greenhouse'
    | 'lever'
    | 'google';
  label: string;
  homepage: string;
  /** What the owner must provide before it runs, or null when it needs nothing. */
  needs: string | null;
  enabled: boolean;
  fetch(f: FetchFn): Promise<FoundListing[]>;
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : ' ';
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/**
 * HTML to short plain text. Some feeds send HTML that is itself entity-encoded, so decode and strip until nothing
 * changes (at most three rounds). The snippet is a teaser, never the whole description.
 */
export function cleanSnippet(html: unknown, max = 500): string | null {
  if (typeof html !== 'string') return null;
  let text = html;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(
      text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' '),
    );
    if (next === text) break;
    text = next;
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * HTML to readable plain text that keeps paragraphs and bullet points. Used for the detail page of a web job.
 * Tags are removed (never rendered), entities decoded, and the result is capped at a paragraph boundary.
 */
export function cleanDescription(html: unknown, max = 8000): string | null {
  if (typeof html !== 'string' || !html.trim()) return null;
  let text = html;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(
      text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n• ')
        .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section|article)>/gi, '\n\n')
        .replace(/<[^>]*>/g, ' '),
    );
    if (next === text) break;
    text = next;
  }
  text = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const para = cut.lastIndexOf('\n\n');
  return `${(para > max * 0.6 ? cut.slice(0, para) : cut).trimEnd()}…`;
}

/** Bangladeshi job sites: results from them (and anything placed in Bangladesh) are shown first. */
export const BD_HOSTS = [
  'bdjobs.com',
  'bikroy.com',
  'jagojobs.com',
  'skill.jobs',
  'chakri.com',
  'nextjobs.com.bd',
  'jobsbd.com',
];
const BD_PLACES =
  /\b(bangladesh|dhaka|dacca|chattogram|chittagong|sylhet|khulna|rajshahi|rangpur|barishal|barisal|mymensingh|gazipur|narayanganj|cumilla|comilla)\b/i;

export type ListingRegion = 'bd' | 'intl';

/**
 * Where a listing is from. Google results come from a search limited to Bangladesh, so they count as Bangladeshi;
 * anything else is Bangladeshi when it is on a known Bangladeshi site or names a Bangladeshi place.
 */
export function regionOf(source: string, url: string, location: string | null): ListingRegion {
  if (source === 'google') return 'bd';
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (BD_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
      return 'bd';
    }
  } catch {
    /* fall through to the place check */
  }
  return location && BD_PLACES.test(location) ? 'bd' : 'intl';
}

/** The kind a found listing belongs to, so it can sit in the matching list on the site. */
export type ListingKind = 'jobs' | 'internships' | 'scholarships';

const INTERN =
  /\b(intern|interns|internship|internships|trainee|trainees|apprentice|apprenticeship|working student|werkstudent|praktikum|praktikant)\b/i;
const SCHOLAR =
  /\b(scholarship|scholarships|fellowship|fellowships|bursary|stipend|grant programme|grant program)\b/i;

/** Classifies by the title first (what the poster calls it), then by tags. Everything else is a job. */
export function classifyListing(title: string, tags: string[] = []): ListingKind {
  if (SCHOLAR.test(title)) return 'scholarships';
  if (INTERN.test(title)) return 'internships';
  const t = tags.join(' ');
  if (SCHOLAR.test(t)) return 'scholarships';
  if (INTERN.test(t)) return 'internships';
  return 'jobs';
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
      description: cleanDescription(j.description),
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
      description: cleanDescription(j.description),
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

const validDate = (v: unknown): Date | null => {
  const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export function parseJobicy(body: unknown): FoundListing[] {
  const jobs = (body as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: FoundListing[] = [];
  for (const j of jobs as Array<Record<string, unknown>>) {
    const url = httpUrlOrNull(j.url);
    const title = str(j.jobTitle, 400);
    const id = j.id !== undefined && j.id !== null ? String(j.id).slice(0, 190) : null;
    if (!url || !title || !id) continue;
    out.push({
      external_id: id,
      title,
      company: str(j.companyName, 250),
      location: str(j.jobGeo, 250) ?? 'Remote',
      snippet: cleanSnippet(j.jobExcerpt),
      description: cleanDescription(j.jobDescription) ?? cleanDescription(j.jobExcerpt),
      url,
      tags: [...tagList(j.jobIndustry), ...tagList(j.jobType)].slice(0, 8),
      posted_at: validDate(j.pubDate),
    });
  }
  return out;
}

export function parseRemoteOk(body: unknown): FoundListing[] {
  if (!Array.isArray(body)) return [];
  const out: FoundListing[] = [];
  for (const j of body as Array<Record<string, unknown>>) {
    const url = httpUrlOrNull(j.url);
    const title = str(j.position, 400);
    const id = j.id !== undefined && j.id !== null ? String(j.id).slice(0, 190) : null;
    if (!url || !title || !id) continue; // the first element is a legal notice and has no position
    out.push({
      external_id: id,
      title,
      company: str(j.company, 250),
      location: str(j.location, 250) ?? 'Remote',
      snippet: cleanSnippet(j.description),
      description: cleanDescription(j.description),
      url,
      tags: tagList(j.tags),
      posted_at: validDate(j.date),
    });
  }
  return out.slice(0, 80);
}

export function parseHimalayas(body: unknown): FoundListing[] {
  const jobs = (body as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: FoundListing[] = [];
  for (const j of jobs as Array<Record<string, unknown>>) {
    const url = httpUrlOrNull(j.applicationLink) ?? httpUrlOrNull(j.guid);
    const title = str(j.title, 400);
    const id = str(j.guid, 190) ?? url;
    if (!url || !title || !id) continue;
    const locs = tagList(j.locationRestrictions);
    out.push({
      external_id: id.slice(0, 190),
      title,
      company: str(j.companyName, 250),
      location: locs.length ? locs.join(', ').slice(0, 250) : 'Remote',
      snippet: cleanSnippet(j.excerpt) ?? cleanSnippet(j.description),
      description: cleanDescription(j.description) ?? cleanDescription(j.excerpt),
      url,
      tags: tagList(j.categories),
      posted_at: typeof j.pubDate === 'number' ? validDate(j.pubDate * 1000) : validDate(j.pubDate),
    });
  }
  return out;
}

const newest = (a: FoundListing, b: FoundListing) =>
  (b.posted_at?.getTime() ?? 0) - (a.posted_at?.getTime() ?? 0);

/** Public Greenhouse job board of one company (documented, unauthenticated). */
export function parseGreenhouse(board: string, label: string, body: unknown): FoundListing[] {
  const jobs = (body as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: FoundListing[] = [];
  for (const j of jobs as Array<Record<string, unknown>>) {
    const url = httpUrlOrNull(j.absolute_url);
    const title = str(j.title, 400);
    if (!url || !title || j.id === undefined) continue;
    out.push({
      external_id: `${board}-${String(j.id)}`.slice(0, 190),
      title,
      company: label,
      location: str((j.location as { name?: unknown } | undefined)?.name, 250),
      snippet: null,
      description: null, // fetched when someone opens the job (see ListingRepo.ensureDescription)
      url,
      tags: [board],
      posted_at: validDate(j.updated_at),
    });
  }
  return out.sort(newest).slice(0, 25);
}

/** Public Lever postings of one company (documented, unauthenticated). */
export function parseLever(board: string, label: string, body: unknown): FoundListing[] {
  if (!Array.isArray(body)) return [];
  const out: FoundListing[] = [];
  for (const j of body as Array<Record<string, unknown>>) {
    const url = httpUrlOrNull(j.hostedUrl);
    const title = str(j.text, 400);
    const id = str(j.id, 100);
    if (!url || !title || !id) continue;
    const cat = (j.categories ?? {}) as Record<string, unknown>;
    out.push({
      external_id: `${board}-${id}`.slice(0, 190),
      title,
      company: label,
      location: str(cat.location, 250),
      snippet: cleanSnippet(j.descriptionPlain),
      description: cleanDescription(j.descriptionPlain) ?? cleanDescription(j.description),
      url,
      tags: [str(cat.team, 40), str(cat.commitment, 40)].filter((t): t is string => Boolean(t)),
      posted_at: validDate(j.createdAt),
    });
  }
  return out.sort(newest).slice(0, 25);
}

/** Companies whose public boards are read. Fixed list: no user-supplied hosts, so no SSRF. */
export const GREENHOUSE_BOARDS: Array<[string, string]> = [
  ['gitlab', 'GitLab'],
  ['stripe', 'Stripe'],
  ['datadog', 'Datadog'],
  ['cloudflare', 'Cloudflare'],
  ['twilio', 'Twilio'],
  ['coursera', 'Coursera'],
  ['duolingo', 'Duolingo'],
  ['figma', 'Figma'],
  ['dropbox', 'Dropbox'],
  ['mongodb', 'MongoDB'],
  ['elastic', 'Elastic'],
];
export const LEVER_BOARDS: Array<[string, string]> = [
  ['spotify', 'Spotify'],
  ['palantir', 'Palantir'],
  ['kraken', 'Kraken'],
];

/** Runs every board; one failing board does not fail the others, but all failing does. */
async function settled(tasks: Array<Promise<FoundListing[]>>): Promise<FoundListing[]> {
  const res = await Promise.allSettled(tasks);
  const ok = res.filter(
    (r): r is PromiseFulfilledResult<FoundListing[]> => r.status === 'fulfilled',
  );
  if (ok.length === 0) throw new Error('No board answered');
  return ok.flatMap((r) => r.value);
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
  /** one or more search phrases separated by "|" */
  googleQuery?: string | undefined;
}

/** Phrases searched on the Bangladeshi job sites the search engine is limited to (one request each). */
const DEFAULT_GOOGLE_QUERIES =
  'jobs in Bangladesh|internship Bangladesh|software engineer Dhaka|accounts officer Dhaka|marketing executive Bangladesh|bank job circular Bangladesh|scholarship Bangladesh|NGO jobs Bangladesh';

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
      id: 'jobicy',
      label: 'Jobicy',
      homepage: 'https://jobicy.com',
      needs: null,
      enabled: true,
      fetch: async (f) =>
        parseJobicy(await getJson(f, 'https://jobicy.com/api/v2/remote-jobs?count=50')),
    },
    {
      id: 'remoteok',
      label: 'Remote OK',
      homepage: 'https://remoteok.com',
      needs: null,
      enabled: true,
      fetch: async (f) => parseRemoteOk(await getJson(f, 'https://remoteok.com/api')),
    },
    {
      id: 'himalayas',
      label: 'Himalayas',
      homepage: 'https://himalayas.app',
      needs: null,
      enabled: true,
      fetch: async (f) =>
        parseHimalayas(await getJson(f, 'https://himalayas.app/jobs/api?limit=50')),
    },
    {
      id: 'greenhouse',
      label: 'Company career pages (Greenhouse)',
      homepage: 'https://www.greenhouse.com',
      needs: null,
      enabled: true,
      fetch: (f) =>
        settled(
          GREENHOUSE_BOARDS.map(async ([b, label]) =>
            parseGreenhouse(
              b,
              label,
              await getJson(f, `https://boards-api.greenhouse.io/v1/boards/${b}/jobs`),
            ),
          ),
        ),
    },
    {
      id: 'lever',
      label: 'Company career pages (Lever)',
      homepage: 'https://www.lever.co',
      needs: null,
      enabled: true,
      fetch: (f) =>
        settled(
          LEVER_BOARDS.map(async ([b, label]) =>
            parseLever(
              b,
              label,
              await getJson(f, `https://api.lever.co/v0/postings/${b}?mode=json`),
            ),
          ),
        ),
    },
    {
      id: 'google',
      label: 'Google Search',
      homepage: 'https://programmablesearchengine.google.com',
      needs: 'GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX',
      enabled: googleReady,
      fetch: async (f) => {
        const queries = (cfg.googleQuery ?? DEFAULT_GOOGLE_QUERIES)
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 10);
        const pages = await Promise.allSettled(
          queries.map(async (phrase) => {
            const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
              cfg.googleKey ?? '',
            )}&cx=${encodeURIComponent(cfg.googleCx ?? '')}&q=${encodeURIComponent(phrase)}&num=10`;
            return parseGoogle(await getJson(f, url));
          }),
        );
        const ok = pages.filter(
          (p): p is PromiseFulfilledResult<FoundListing[]> => p.status === 'fulfilled',
        );
        if (ok.length === 0) throw new Error('No search answered');
        const seen = new Set<string>();
        return ok
          .flatMap((p) => p.value)
          .filter((l) => (seen.has(l.external_id) ? false : (seen.add(l.external_id), true)));
      },
    },
  ];
}
