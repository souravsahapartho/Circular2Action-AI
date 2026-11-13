import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { hmac, safeEqual } from './crypto';

/** RFC 6238 time-based one-time passwords (SHA-1, 30 s step, 6 digits) with a +-1 step window. */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secretB32: string, timeMs: number, digits = 6): string {
  const counter = Math.floor(timeMs / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code =
    (((h[offset]! & 0x7f) << 24) |
      (h[offset + 1]! << 16) |
      (h[offset + 2]! << 8) |
      h[offset + 3]!) %
    10 ** digits;
  return String(code).padStart(digits, '0');
}

/** Accepts the current code and the previous and next steps (clock drift). */
export function verifyTotp(secretB32: string, code: string, nowMs: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let ok = false;
  for (const step of [-1, 0, 1]) {
    if (safeEqual(totpAt(secretB32, nowMs + step * 30_000), code)) ok = true;
  }
  return ok;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'Circular2Action'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** AES-256-GCM at rest (plan SEC-42). Layout: iv(12) | tag(16) | ciphertext. */
function key(secret: string): Buffer {
  return hmac(secret, 'totp-secret-key');
}

export function encryptSecret(secret: string, plaintext: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(secret), iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decryptSecret(secret: string, blob: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', key(secret), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
}

/** Ten recovery codes like `ab3k-9xmq-7tzp`; only their hashes are stored. */
export function newRecoveryCodes(n = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(12);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]!).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, '');
}
