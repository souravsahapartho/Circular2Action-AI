import 'server-only';
import { cookies } from 'next/headers';

/**
 * Server-side calls to the API. The browser uses the same-origin /api rewrite; server components call the API
 * origin directly and forward the visitor's cookies when `auth` is set. Results are typed as success, not-found,
 * unauthenticated or unavailable so every page shows an honest state instead of invented data.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

export type ApiResult<T> =
  | { kind: 'ok'; data: T; total?: number }
  | { kind: 'not_found' }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden'; code?: string }
  | { kind: 'unavailable'; status?: number };

export const SESSION_COOKIES = ['__Host-c2a_session', 'c2a_session'];

export async function cookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .filter((c) => c.name.includes('c2a_'))
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
}

export async function hasSession(): Promise<boolean> {
  const jar = await cookies();
  return SESSION_COOKIES.some((n) => jar.has(n));
}

/**
 * A sleeping free API instance can take about a minute to answer, so the first attempt waits long and a second
 * attempt follows before the page reports "unavailable".
 */
export async function apiGet<T>(
  path: string,
  opts: { timeoutMs?: number; auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.auth) {
    const c = await cookieHeader();
    if (!c) return { kind: 'unauthenticated' };
    headers.cookie = c;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_ORIGIN}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers,
        cache: 'no-store',
      });
      if (res.status === 404) return { kind: 'not_found' };
      if (res.status === 401) return { kind: 'unauthenticated' };
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        return { kind: 'forbidden', ...(body?.error?.code ? { code: body.error.code } : {}) };
      }
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
  closed?: boolean;
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

export interface CategoryInfo {
  slug: string;
  kind: string;
  name: string;
  count: number;
}

export interface LocationInfo {
  id: string;
  slug: string;
  type: string;
  name: string;
}

export { idFromSlug, safeHref } from './urls';
