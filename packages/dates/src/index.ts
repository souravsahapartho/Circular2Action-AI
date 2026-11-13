/**
 * Date and time handling for circulars (plan §13.5, §19.2).
 * Rules: Bangla and Latin digits, Bangla and English month names, dd/mm/yyyy and dd-mm-yyyy,
 * 12-hour times with বিকাল/সকাল/রাত/দুপুর/সন্ধ্যা, invalid dates rejected, two-digit years rejected,
 * never guess. Bangladesh is UTC+6 with no daylight saving.
 */

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const DHAKA_OFFSET_MIN = 6 * 60;

export interface ParsedDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface ParsedDateTime extends ParsedDate {
  hour: number | null;
  minute: number | null;
  precision: 'date' | 'datetime';
}

function foldDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const i = BN_DIGITS.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  জানুয়ারি: 1,
  জানুয়ারী: 1,
  february: 2,
  feb: 2,
  ফেব্রুয়ারি: 2,
  ফেব্রুয়ারী: 2,
  march: 3,
  mar: 3,
  মার্চ: 3,
  april: 4,
  apr: 4,
  এপ্রিল: 4,
  may: 5,
  মে: 5,
  june: 6,
  jun: 6,
  জুন: 6,
  july: 7,
  jul: 7,
  জুলাই: 7,
  august: 8,
  aug: 8,
  আগস্ট: 8,
  আগষ্ট: 8,
  september: 9,
  sep: 9,
  sept: 9,
  সেপ্টেম্বর: 9,
  october: 10,
  oct: 10,
  অক্টোবর: 10,
  november: 11,
  nov: 11,
  নভেম্বর: 11,
  december: 12,
  dec: 12,
  ডিসেম্বর: 12,
};

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

function validDate(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

interface TimeResult {
  hour: number;
  minute: number;
}

/** Parse a clock time such as "5.00 PM", "বিকাল ৫:০০", "17:30", "সকাল ১০টা". Returns null if not recognised. */
export function parseTime(raw: string): TimeResult | null {
  const s = foldDigits(raw).toLowerCase();
  const m = /(\d{1,2})(?:[.:](\d{2}))?\s*(?:টা|টায়|ঘটিকা|ঘটিকায়)?/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (minute > 59 || hour > 23) return null;

  const hasPm = /\bpm\b|p\.m\.|বিকাল|বিকেল|সন্ধ্যা|সন্ধ্যায়/.test(s);
  const hasAm = /\bam\b|a\.m\.|সকাল|ভোর/.test(s);
  const isNoon = /দুপুর/.test(s);
  const isNight = /রাত/.test(s);

  if (hasPm || hasAm || isNoon || isNight) {
    if (hour === 0) return null; // "0 PM" and similar are invalid
    if (hour <= 12) {
      if (hasAm) hour = hour === 12 ? 0 : hour;
      else if (isNoon) hour = hour >= 1 && hour <= 3 ? hour + 12 : hour;
      else if (hasPm) hour = hour === 12 ? 12 : hour + 12;
      else if (isNight) hour = hour === 12 ? 0 : hour >= 6 ? hour + 12 : hour;
    }
  }
  return { hour, minute };
}

/**
 * Parse a date (and optional time) from circular text.
 * Returns null when the text is not an unambiguous complete date. Never guesses missing parts.
 */
export function parseDateTime(raw: string): ParsedDateTime | null {
  const s = foldDigits(raw.normalize('NFC'))
    .replace(/[\u200B\u200C\u200D]/g, '')
    .trim();
  let date: ParsedDate | null = null;
  let rest = s;

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (four-digit year only)
  const numeric = /(?<![\d])(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?![\d])/.exec(s);
  if (numeric) {
    const d = Number(numeric[1]);
    const mo = Number(numeric[2]);
    const y = Number(numeric[3]);
    if (!validDate(y, mo, d)) return null;
    date = { year: y, month: mo, day: d };
    rest = s.slice(0, numeric.index) + ' ' + s.slice(numeric.index + numeric[0].length);
  } else {
    // "15 December 2026" / "১৫ ডিসেম্বর ২০২৬" / "December 15, 2026"
    const dmy =
      /(?<![\d])(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+([\p{L}\p{M}]+)\.?,?\s+(\d{4})(?![\d])/u.exec(s);
    const mdy = /([\p{L}\p{M}]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?![\d])/u.exec(s);
    if (dmy && MONTHS[dmy[2]!.toLowerCase()]) {
      const mo = MONTHS[dmy[2]!.toLowerCase()]!;
      const d = Number(dmy[1]);
      const y = Number(dmy[3]);
      if (!validDate(y, mo, d)) return null;
      date = { year: y, month: mo, day: d };
      rest = s.slice(0, dmy.index) + ' ' + s.slice(dmy.index + dmy[0].length);
    } else if (mdy && MONTHS[mdy[1]!.toLowerCase()]) {
      const mo = MONTHS[mdy[1]!.toLowerCase()]!;
      const d = Number(mdy[2]);
      const y = Number(mdy[3]);
      if (!validDate(y, mo, d)) return null;
      date = { year: y, month: mo, day: d };
      rest = s.slice(0, mdy.index) + ' ' + s.slice(mdy.index + mdy[0].length);
    }
  }
  if (!date) return null;

  const hasTimeMarker =
    /\d{1,2}[.:]\d{2}|\bam\b|\bpm\b|a\.m\.|p\.m\.|সকাল|বিকাল|বিকেল|দুপুর|সন্ধ্যা|রাত|টা\b|টায়/i.test(
      rest,
    );
  if (!hasTimeMarker) return { ...date, hour: null, minute: null, precision: 'date' };
  const t = parseTime(rest);
  if (!t) return { ...date, hour: null, minute: null, precision: 'date' };
  return { ...date, hour: t.hour, minute: t.minute, precision: 'datetime' };
}

/**
 * Convert a parsed Bangladesh-local date or datetime to a UTC instant.
 * Date-only deadlines are stored as 23:59:59 local time (plan §11.7).
 */
export function dhakaToUtc(p: ParsedDateTime): Date {
  const h = p.precision === 'datetime' ? (p.hour ?? 0) : 23;
  const mi = p.precision === 'datetime' ? (p.minute ?? 0) : 59;
  const s = p.precision === 'datetime' ? 0 : 59;
  return new Date(Date.UTC(p.year, p.month - 1, p.day, h, mi, s) - DHAKA_OFFSET_MIN * 60_000);
}

/** The Bangladesh calendar date (yyyy-mm-dd) of an instant. */
export function toDhakaDateString(d: Date): string {
  const t = new Date(d.getTime() + DHAKA_OFFSET_MIN * 60_000);
  return t.toISOString().slice(0, 10);
}

export interface Age {
  years: number;
  months: number;
  days: number;
}

/** Age in whole years, months and days at `asOf` (both as yyyy-mm-dd). Returns null if dob is after asOf or invalid. */
export function ageAt(dob: string, asOf: string): Age | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!a || !b) return null;
  const [dy, dm, dd] = [Number(a[1]), Number(a[2]), Number(a[3])];
  const [ay, am, ad] = [Number(b[1]), Number(b[2]), Number(b[3])];
  if (!validDate(dy, dm, dd) || !validDate(ay, am, ad)) return null;
  if (dy > ay || (dy === ay && (dm > am || (dm === am && dd > ad)))) return null;
  // Anchor method: add whole months to the birth date (day clamped to month end, so a 31st or a leap day
  // attains each month on the last day of shorter months), then count remaining days.
  // Leap-day convention (Feb 29 attains the year on Feb 28 in common years) is documented in docs/adr and is an
  // open item for legal confirmation (plan UQ-12); callers may treat leap-day births as "needs verification".
  const anchorFor = (totalMonths: number): number => {
    const ty = dy + Math.floor((dm - 1 + totalMonths) / 12);
    const tm = ((dm - 1 + totalMonths) % 12) + 1;
    return Date.UTC(ty, tm - 1, Math.min(dd, daysInMonth(ty, tm)));
  };
  const asOfMs = Date.UTC(ay, am - 1, ad);
  let totalMonths = (ay - dy) * 12 + (am - dm);
  while (totalMonths > 0 && anchorFor(totalMonths) > asOfMs) totalMonths -= 1;
  const days = Math.round((asOfMs - anchorFor(totalMonths)) / 86_400_000);
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, days };
}

/** Compare ages with a maximum "up to and including N years" rule: true if age <= maxYears in whole days sense. */
export function ageWithin(age: Age, maxYears: number): boolean {
  return age.years < maxYears || (age.years === maxYears && age.months === 0 && age.days === 0);
}

/** Whole days remaining between two instants using Bangladesh calendar days. Negative when passed. */
export function daysLeft(now: Date, deadline: Date): number {
  const a = Date.parse(toDhakaDateString(now));
  const b = Date.parse(toDhakaDateString(deadline));
  return Math.round((b - a) / 86_400_000);
}

/** Total months between two yyyy-mm-dd dates, ignoring partial months (for experience sums). */
export function monthsBetween(from: string, to: string): number {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return 0;
  const total =
    (Number(b[1]) - Number(a[1])) * 12 +
    (Number(b[2]) - Number(a[2])) -
    (Number(b[3]) < Number(a[3]) ? 1 : 0);
  return Math.max(0, total);
}

/** Sum of non-overlapping day ranges (inclusive), used for experience calculation (plan C-04). */
export function sumNonOverlappingDays(ranges: Array<{ from: string; to: string }>): number {
  const parsed = ranges
    .map((r) => ({ f: Date.parse(r.from), t: Date.parse(r.to) }))
    .filter((r) => Number.isFinite(r.f) && Number.isFinite(r.t) && r.t >= r.f)
    .sort((x, y) => x.f - y.f);
  let total = 0;
  let curF = -Infinity;
  let curT = -Infinity;
  for (const r of parsed) {
    if (r.f > curT) {
      if (curT > -Infinity) total += (curT - curF) / 86_400_000 + 1;
      curF = r.f;
      curT = r.t;
    } else if (r.t > curT) {
      curT = r.t;
    }
  }
  if (curT > -Infinity) total += (curT - curF) / 86_400_000 + 1;
  return Math.round(total);
}
