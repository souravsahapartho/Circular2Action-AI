import { describe, expect, it } from 'vitest';
import { cookieNames, parseCookies, serializeCookie } from '../src/modules/auth/cookies';
import {
  hashPassword,
  needsRehash,
  newToken,
  normalizeEmail,
  passwordProblem,
  verifyPassword,
} from '../src/modules/auth/crypto';
import { issueCsrf, originAllowed, verifyCsrf } from '../src/modules/auth/csrf';

describe('auth crypto', () => {
  it('hashes with Argon2id at the planned parameters and verifies', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong password!!')).toBe(false);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$abc$def')).toBe(true);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('password policy: 10..128 characters, counted as code points (Bangla included)', () => {
    expect(passwordProblem('short')).not.toBeNull();
    expect(passwordProblem('a'.repeat(10))).toBeNull();
    expect(passwordProblem('a'.repeat(129))).not.toBeNull();
    expect(passwordProblem('পাসওয়ার্ড১২৩৪')).toBeNull();
  });

  it('tokens are 32 random bytes in base64url', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
  });

  it('normalises email', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });
});

describe('cookies', () => {
  it('uses __Host- names with Secure outside local development', () => {
    expect(cookieNames('staging')).toEqual({
      session: '__Host-c2a_session',
      csrf: '__Host-c2a_csrf',
      secure: true,
    });
    expect(cookieNames('local').secure).toBe(false);
  });

  it('serialises with HttpOnly, SameSite=Lax, Path=/ and parses back', () => {
    const c = serializeCookie('__Host-c2a_session', 'a b', {
      secure: true,
      httpOnly: true,
      maxAgeSeconds: 60,
    });
    expect(c).toBe('__Host-c2a_session=a%20b; Path=/; SameSite=Lax; HttpOnly; Secure; Max-Age=60');
    expect(parseCookies('x=1; __Host-c2a_session=a%20b; x=2')).toEqual({
      x: '1',
      '__Host-c2a_session': 'a b',
    });
  });
});

describe('csrf', () => {
  const key = 'k'.repeat(40);
  it('accepts a matching signed token and rejects forged, mismatched or missing ones', () => {
    const t = issueCsrf(key);
    expect(verifyCsrf(key, t, t)).toBe(true);
    expect(verifyCsrf(key, t, issueCsrf(key))).toBe(false);
    expect(verifyCsrf(key, 'abc.def', 'abc.def')).toBe(false);
    expect(verifyCsrf('other'.repeat(10), t, t)).toBe(false);
    expect(verifyCsrf(key, undefined, t)).toBe(false);
  });

  it('origin must match the web origin when present', () => {
    expect(originAllowed(undefined, 'https://c2a-web.vercel.app')).toBe(true);
    expect(originAllowed('https://c2a-web.vercel.app', 'https://c2a-web.vercel.app/')).toBe(true);
    expect(originAllowed('https://evil.example', 'https://c2a-web.vercel.app')).toBe(false);
    expect(originAllowed('null', 'https://c2a-web.vercel.app')).toBe(false);
    // several allowed web origins (Vercel and a Render-hosted copy)
    const both = ['https://c2a-web.vercel.app', 'https://c2a-web-staging.onrender.com'];
    expect(originAllowed('https://c2a-web-staging.onrender.com', both)).toBe(true);
    expect(originAllowed('https://evil.example', both)).toBe(false);
  });
});
