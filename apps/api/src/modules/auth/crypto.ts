import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';

/** Argon2id with the OWASP minimum profile (plan section 9.9, SEC-01). Parameters live in the hash string. */
export const ARGON2_PARAMS = {
  algorithm: 2 as Algorithm, // Algorithm.Argon2id (a const enum, not usable under isolatedModules)
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
const PARAM_TAG = `m=${ARGON2_PARAMS.memoryCost},t=${ARGON2_PARAMS.timeCost},p=${ARGON2_PARAMS.parallelism}`;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** True when the stored hash used other parameters and should be rehashed after a successful login. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith('$argon2id$') || !stored.includes(PARAM_TAG);
}

/** A hash of a random password, verified when the account does not exist so timing does not reveal it. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** 32 random bytes, base64url (session and single-use tokens). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function hmac(key: string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Password policy (plan 9.9): length 10..128, no composition rules. */
export function passwordProblem(password: string): string | null {
  const n = [...password].length;
  if (n < 8) return 'Password must be at least 8 characters.';
  if (n > 128) return 'Password must be at most 128 characters.';
  if (!/\p{Ll}/u.test(password)) return 'Password must include a lowercase letter.';
  if (!/\p{Lu}/u.test(password)) return 'Password must include an uppercase letter.';
  if (!/[^\p{L}\p{N}\s]/u.test(password)) return 'Password must include a special character.';
  return null;
}
