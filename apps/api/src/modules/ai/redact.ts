/**
 * Redaction of user contact data before any prompt (plan AIP-08). Emails, phone numbers and long identifiers are
 * replaced by placeholders and re-inserted after the call. Bangla digits are folded for detection only, and the
 * folding preserves string length so match offsets apply to the original text.
 */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

function foldDigitsKeepLength(s: string): string {
  let out = '';
  for (const ch of s) {
    const i = BN_DIGITS.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

export interface Redaction {
  text: string;
  /** placeholder -> original value */
  map: Record<string, string>;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Bangladesh mobile numbers: 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX, optionally with spaces or dashes
const BD_MOBILE = /(?:\+?88)?[\s-]?01[3-9][\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{3}/g;
// Long digit sequences (national IDs, passport numbers): 9 or more digits
const LONG_DIGITS = /\b\d{9,}\b/g;

const PASSES: Array<[RegExp, string]> = [
  [EMAIL, 'EMAIL'],
  [BD_MOBILE, 'PHONE'],
  [LONG_DIGITS, 'ID'],
];

export function redactContacts(input: string): Redaction {
  const map: Record<string, string> = {};
  let counter = 0;
  let current = input;
  for (const [re, label] of PASSES) {
    const folded = foldDigitsKeepLength(current);
    let out = current;
    for (const m of [...folded.matchAll(re)].reverse()) {
      const start = m.index ?? 0;
      const original = out.slice(start, start + m[0].length);
      if (original.includes('{{')) continue; // already a placeholder
      counter += 1;
      const key = `{{${label}_${counter}}}`;
      map[key] = original;
      out = out.slice(0, start) + key + out.slice(start + m[0].length);
    }
    current = out;
  }
  return { text: current, map };
}

/** Put the original values back into the model output. */
export function restoreContacts(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

/** True if the text contains something that looks like contact data (PII screen for anonymous free text). */
export function looksLikePersonalData(input: string): boolean {
  const f = foldDigitsKeepLength(input);
  return PASSES.some(([re]) => new RegExp(re.source).test(f));
}
