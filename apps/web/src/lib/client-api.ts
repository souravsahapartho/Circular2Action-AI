/** Browser-side API calls through the same-origin /api rewrite, with the CSRF double-submit header. */

export interface ApiError {
  code: string;
  message: string;
  details?: Array<{ path: string; code: string; message: string }>;
}

export interface ApiOutcome<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: ApiError;
}

const CSRF_COOKIES = ['__Host-c2a_csrf', 'c2a_csrf'];

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function csrfToken(): Promise<string> {
  for (const n of CSRF_COOKIES) {
    const v = readCookie(n);
    if (v) return v;
  }
  const res = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const body = (await res.json()) as { data: { csrf_token: string } };
  return body.data.csrf_token;
}

export async function callApi<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiOutcome<T>> {
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      headers['x-csrf-token'] = await csrfToken();
    }
    const res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return { ok: true, status: 204 };
    const json = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
    if (res.ok)
      return {
        ok: true,
        status: res.status,
        ...(json?.data !== undefined ? { data: json.data } : {}),
      };
    return {
      ok: false,
      status: res.status,
      error: json?.error ?? { code: 'INTERNAL_ERROR', message: 'Request failed.' },
    };
  } catch {
    return { ok: false, status: 0, error: { code: 'NETWORK', message: 'Network error' } };
  }
}

/** A readable message for an outcome, in the visitor's language. */
export function errorMessage(errors: Record<string, string>, out: ApiOutcome<unknown>): string {
  if (out.status === 0) return errors.network ?? 'Network error';
  const code = out.error?.code ?? '';
  return errors[code] ?? errors.generic ?? 'Something went wrong.';
}

/** Per-field messages from a 422 response (`details[].path`). */
export function fieldErrors(out: ApiOutcome<unknown>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const d of out.error?.details ?? []) if (!(d.path in m)) m[d.path] = d.message;
  return m;
}
