import { randomBytes } from 'node:crypto';
import { hmac, safeEqual } from './crypto';

/**
 * Signed double-submit CSRF token (plan 9.9 pre-session CSRF). The token is `<nonce>.<sig>` where
 * sig = HMAC(key, nonce). The browser holds it in a readable cookie and echoes it in `X-CSRF-Token`; the server
 * checks that both match and that the signature is valid, so a token cannot be forged or planted by another site.
 */
export function issueCsrf(key: string): string {
  const nonce = randomBytes(18).toString('base64url');
  return `${nonce}.${hmac(key, `csrf:${nonce}`).toString('base64url')}`;
}

export function verifyCsrf(
  key: string,
  cookieToken: string | undefined,
  headerToken: string | undefined,
): boolean {
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) return false;
  const [nonce, sig] = cookieToken.split('.');
  if (!nonce || !sig) return false;
  return safeEqual(sig, hmac(key, `csrf:${nonce}`).toString('base64url'));
}

/** Origin check: a present Origin header must equal an allowed web origin. Absent Origin is allowed (non-browser clients). */
export function originAllowed(
  origin: string | undefined,
  allowed: string | readonly string[],
): boolean {
  if (!origin) return true;
  try {
    const o = new URL(origin).origin;
    return (typeof allowed === 'string' ? [allowed] : allowed).some((a) => new URL(a).origin === o);
  } catch {
    return false;
  }
}
