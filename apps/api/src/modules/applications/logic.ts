import { randomInt } from 'node:crypto';

/** Statuses of an application made through this site (plan v1.2 section 3). */
export const SITE_STATUSES = [
  'submitted',
  'under_review',
  'shortlisted',
  'interview',
  'accepted',
  'rejected',
  'withdrawn',
] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const TERMINAL: ReadonlySet<SiteStatus> = new Set(['accepted', 'rejected', 'withdrawn']);

/** What staff may move an application to. Withdrawing is the applicant's own action. */
const STAFF_NEXT: Record<SiteStatus, readonly SiteStatus[]> = {
  submitted: ['under_review', 'shortlisted', 'rejected'],
  under_review: ['shortlisted', 'interview', 'accepted', 'rejected'],
  shortlisted: ['interview', 'accepted', 'rejected'],
  interview: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

export function staffCanMove(from: SiteStatus, to: SiteStatus): boolean {
  return STAFF_NEXT[from].includes(to);
}

export function applicantCanWithdraw(from: SiteStatus): boolean {
  return !TERMINAL.has(from);
}

// No 0/O, 1/I/L, so a code read aloud or copied from a screenshot is not misread.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TRACKING_CODE = /^C2A-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

/** `C2A-XXXX-XXXX`: eight characters from a 31-symbol alphabet, about 39.6 bits. */
export function newTrackingCode(pick: (max: number) => number = (n) => randomInt(n)): string {
  const chars = (n: number) =>
    Array.from({ length: n }, () => ALPHABET[pick(ALPHABET.length)]).join('');
  return `C2A-${chars(4)}-${chars(4)}`;
}

/** Accepts what people type: lower case, spaces, missing dashes. Returns the canonical form or null. */
export function normalizeTrackingCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('C2A') ? raw.slice(3) : raw;
  if (body.length !== 8) return null;
  const code = `C2A-${body.slice(0, 4)}-${body.slice(4)}`;
  return TRACKING_CODE.test(code) ? code : null;
}
