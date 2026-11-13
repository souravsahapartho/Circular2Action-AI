import 'server-only';

/**
 * Server-side calls to the API. On Vercel the browser uses the /api rewrite; server components call the API origin
 * directly. Results are typed as success, not-found or unavailable so every page can show an honest state
 * (plan section 7.8) instead of invented data.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

export type ApiResult<T> =
  { kind: 'ok'; data: T } | { kind: 'not_found' } | { kind: 'unavailable'; status?: number };

export async function apiGet<T>(path: string, timeoutMs = 8000): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_ORIGIN}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
      next: { revalidate: 60 },
    });
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'unavailable', status: res.status };
    const body = (await res.json()) as { data: T };
    return { kind: 'ok', data: body.data };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Opportunity list row as returned by GET /api/v1/opportunities (plan section 12.2; provisional until the module ships). */
export interface OpportunitySummary {
  id: string;
  slug: string;
  title: string;
  organization: string;
  location?: string | null;
  deadline_at?: string | null;
  category?: string | null;
}

export interface OpportunityDetail extends OpportunitySummary {
  summary?: string | null;
  source_url?: string | null;
  verified?: boolean;
}

/** `/{locale}/opportunities/{slug}-{id}`: the trailing id is authoritative (plan 8.1). */
export function idFromSlug(slug: string): string | null {
  const m = /-(\d{1,20})$/.exec(slug) ?? /^(\d{1,20})$/.exec(slug);
  return m ? m[1]! : null;
}
