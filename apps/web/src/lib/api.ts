import 'server-only';

/**
 * Server-side calls to the API. On a host that proxies /api (Vercel or the Render web service) the browser uses the
 * same-origin /api rewrite; server components call the API origin directly. Results are typed as success, not-found or
 * unavailable so every page shows an honest state (plan section 7.8) instead of invented data.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

export type ApiResult<T> =
  | { kind: 'ok'; data: T; total?: number }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; status?: number };

/**
 * A sleeping free API instance can take about a minute to answer, so the first attempt waits long and a second
 * attempt follows before the page reports "unavailable".
 */
export async function apiGet<T>(path: string, timeoutMs = 25_000): Promise<ApiResult<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_ORIGIN}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.status === 404) return { kind: 'not_found' };
      if (res.status >= 500 && attempt === 0) continue;
      if (!res.ok) return { kind: 'unavailable', status: res.status };
      const body = (await res.json()) as { data: T; meta?: { total?: number } };
      return { kind: 'ok', data: body.data, total: body.meta?.total };
    } catch {
      if (attempt === 1) return { kind: 'unavailable' };
    }
  }
  return { kind: 'unavailable' };
}

export interface OpportunitySummary {
  id: string;
  slug: string;
  title: string;
  organization: string;
  location?: string | null;
  deadline_at?: string | null;
  category?: string | null;
  category_slug?: string | null;
}

export interface ApiRequirement {
  id: string;
  rule_type: string;
  necessity: 'mandatory' | 'preferred' | 'conditional';
  group_key: string;
  branch_key: string;
  params: Record<string, unknown>;
  machine_evaluable: boolean;
  verified: boolean;
  text: string | null;
}

export interface OpportunityDetail extends OpportunitySummary {
  summary?: string | null;
  source_url?: string | null;
  verified?: boolean;
  positions?: string | null;
  vacancies?: number | null;
  application_url?: string | null;
  how_to_apply?: string | null;
  requirements?: ApiRequirement[];
}

/** `/{locale}/opportunities/{slug}-{id}`: the trailing id is authoritative (plan 8.1). */
export function idFromSlug(slug: string): string | null {
  const m = /-(\d{1,20})$/.exec(slug) ?? /^(\d{1,20})$/.exec(slug);
  return m ? m[1]! : null;
}
