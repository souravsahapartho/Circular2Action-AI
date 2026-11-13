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
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  totpAt,
  verifyTotp,
} from '../src/modules/auth/totp';

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

describe('staff two-factor (TOTP)', () => {
  // RFC 6238 appendix B: secret "12345678901234567890", SHA-1, T = 59 s -> 94287082 (8 digits)
  const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC 6238 test vectors', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpAt(RFC_SECRET, 59_000, 8)).toBe('94287082');
    expect(totpAt(RFC_SECRET, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totpAt(RFC_SECRET, 20_000_000_000_000, 8)).toBe('65353130');
    expect(totpAt(RFC_SECRET, 59_000)).toBe('287082');
  });

  it('accepts the current and adjacent steps only, and malformed codes never', () => {
    const now = 1_700_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90_000), now)).toBe(false);
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 3456']) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toBe(false);
    }
  });

  it('base32 round trips and the setup URI carries the secret and issuer', () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
    const uri = otpauthUri(s, 'a@b.test');
    expect(uri).toContain(`secret=${s}`);
    expect(uri).toContain('issuer=Circular2Action');
  });

  it('encrypts the secret at rest with AES-256-GCM and rejects tampering or a wrong key', () => {
    const key = 'k'.repeat(40);
    const blob = encryptSecret(key, 'JBSWY3DPEHPK3PXP');
    expect(blob.toString('utf8')).not.toContain('JBSWY3DP');
    expect(decryptSecret(key, blob)).toBe('JBSWY3DPEHPK3PXP');
    expect(encryptSecret(key, 'JBSWY3DPEHPK3PXP').equals(blob)).toBe(false); // fresh IV each time
    expect(() => decryptSecret('x'.repeat(40), blob)).toThrow();
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() => decryptSecret(key, tampered)).toThrow();
  });

  it('generates ten distinct recovery codes that normalise predictably', () => {
    const codes = newRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(normalizeRecoveryCode('  AB3K-9XMQ-7TZP ')).toBe('ab3k-9xmq-7tzp');
  });
});
