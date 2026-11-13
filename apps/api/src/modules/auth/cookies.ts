/**
 * Cookie names and attributes (plan 9.9). `__Host-` cookies require Secure, so plain-http local development uses
 * unprefixed names; every deployed environment (staging, production) uses the `__Host-` names.
 */
export interface CookieNames {
  session: string;
  csrf: string;
  secure: boolean;
}

export function cookieNames(appEnv: 'local' | 'staging' | 'production'): CookieNames {
  return appEnv === 'local'
    ? { session: 'c2a_session', csrf: 'c2a_csrf', secure: false }
    : { session: '__Host-c2a_session', csrf: '__Host-c2a_csrf', secure: true };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { secure: boolean; httpOnly: boolean; maxAgeSeconds?: number },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  return parts.join('; ');
}
