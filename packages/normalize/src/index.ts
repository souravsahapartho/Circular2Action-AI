/**
 * Shared text normalisation (plan §9.8, A-04, §19.2).
 * Matching form: NFC, joiners removed, Bangla digits folded to ASCII, lower-cased, punctuation stripped.
 * The original text is always kept separately for display.
 */

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Fold Bangla digits (০-৯) to ASCII digits. */
export function foldDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const i = BN_DIGITS.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

/** Remove zero-width joiner/non-joiner and other invisible format characters (matching only). */
export function stripInvisibles(input: string): string {
  return input.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
}

/** Normalised form used for matching, indexing and duplicate keys. Never use it for display. */
export function normalizeForMatch(input: string): string {
  const nfc = input.normalize('NFC');
  const folded = foldDigits(stripInvisibles(nfc)).toLowerCase();
  return folded
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a normalised string into tokens. */
export function tokenize(input: string): string[] {
  const n = normalizeForMatch(input);
  return n === '' ? [] : n.split(' ');
}

/** Character trigrams over the normalised string (used by the n-gram search fallback, ADR-008). */
export function trigrams(input: string): string[] {
  const out = new Set<string>();
  for (const token of tokenize(input)) {
    const chars = Array.from(`  ${token} `);
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(''));
  }
  return [...out];
}

/** Normalised key for reference numbers and organisation names used in duplicate detection (A-10). */
export function normalizeReferenceNo(input: string): string {
  return foldDigits(stripInvisibles(input.normalize('NFC')))
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

/**
 * URL-safe slug. Bangla letters are kept (Unicode slug); everything else becomes a hyphen.
 * The numeric ID in the URL is authoritative (plan §8.1), so slugs need not be unique by themselves.
 */
export function slugify(input: string, maxLength = 80): string {
  const s = normalizeForMatch(input).replace(/\s/g, '-');
  return Array.from(s).slice(0, maxLength).join('').replace(/-+$/g, '');
}
