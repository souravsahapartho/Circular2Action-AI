import { describe, expect, it } from 'vitest';
import {
  ageAt,
  ageWithin,
  daysLeft,
  dhakaToUtc,
  monthsBetween,
  parseDateTime,
  parseTime,
  sumNonOverlappingDays,
  toDhakaDateString,
} from '../src/index';

describe('parseDateTime', () => {
  it('parses Bangla date with time', () => {
    const r = parseDateTime('১৫ ডিসেম্বর ২০২৬ বিকাল ৫.০০ টা');
    expect(r).toMatchObject({
      year: 2026,
      month: 12,
      day: 15,
      hour: 17,
      minute: 0,
      precision: 'datetime',
    });
  });

  it('parses English month names and ordinals', () => {
    expect(parseDateTime('15 December 2026')).toMatchObject({
      year: 2026,
      month: 12,
      day: 15,
      precision: 'date',
    });
    expect(parseDateTime('December 15, 2026')).toMatchObject({ month: 12, day: 15 });
    expect(parseDateTime('1st Jan 2027')).toMatchObject({ year: 2027, month: 1, day: 1 });
  });

  it('parses numeric formats with Bangla and Latin digits', () => {
    expect(parseDateTime('১৫/১২/২০২৬')).toMatchObject({ year: 2026, month: 12, day: 15 });
    expect(parseDateTime('15-12-2026')).toMatchObject({ day: 15, month: 12 });
    expect(parseDateTime('15.12.2026')).toMatchObject({ day: 15, month: 12 });
  });

  it('accepts alternative Bangla spellings', () => {
    expect(parseDateTime('১০ জানুয়ারী ২০২৭')).toMatchObject({ month: 1 });
    expect(parseDateTime('২ ফেব্রুয়ারী ২০২৭')).toMatchObject({ month: 2 });
  });

  it('rejects invalid calendar dates, two-digit years and incomplete text', () => {
    expect(parseDateTime('31/02/2026')).toBeNull();
    expect(parseDateTime('29/02/2025')).toBeNull();
    expect(parseDateTime('15.12.26')).toBeNull();
    expect(parseDateTime('15 Decembr 2026')).toBeNull();
    expect(parseDateTime('December 2026')).toBeNull();
    expect(parseDateTime('')).toBeNull();
  });

  it('accepts a leap day only in leap years', () => {
    expect(parseDateTime('29/02/2028')).toMatchObject({ day: 29, month: 2 });
  });
});

describe('parseTime', () => {
  it.each([
    ['5.00 PM', 17, 0],
    ['12 PM', 12, 0],
    ['12 AM', 0, 0],
    ['বিকাল ৫:৩০', 17, 30],
    ['সকাল ১০টা', 10, 0],
    ['দুপুর ২টা', 14, 0],
    ['রাত ১২টা', 0, 0],
    ['রাত ১১টা', 23, 0],
    ['17:30', 17, 30],
  ])('parses %s', (text, h, m) => {
    expect(parseTime(text)).toEqual({ hour: h, minute: m });
  });

  it('rejects impossible times', () => {
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('0 PM')).toBeNull();
    expect(parseTime('10:75')).toBeNull();
  });
});

describe('Dhaka time conversion', () => {
  it('converts a datetime to UTC (UTC+6, no DST)', () => {
    const p = parseDateTime('15 December 2026 5.00 PM')!;
    expect(dhakaToUtc(p).toISOString()).toBe('2026-12-15T11:00:00.000Z');
  });

  it('stores date-only deadlines as 23:59:59 Dhaka time', () => {
    const p = parseDateTime('15 December 2026')!;
    expect(dhakaToUtc(p).toISOString()).toBe('2026-12-15T17:59:59.000Z');
  });

  it('computes the Dhaka calendar date near midnight boundaries', () => {
    expect(toDhakaDateString(new Date('2026-12-15T17:59:59Z'))).toBe('2026-12-15');
    expect(toDhakaDateString(new Date('2026-12-15T18:00:00Z'))).toBe('2026-12-16');
  });

  it('counts days left in Dhaka calendar days', () => {
    expect(daysLeft(new Date('2026-12-12T10:00:00Z'), new Date('2026-12-15T17:59:59Z'))).toBe(3);
    expect(daysLeft(new Date('2026-12-16T10:00:00Z'), new Date('2026-12-15T17:59:59Z'))).toBe(-1);
    expect(daysLeft(new Date('2026-12-15T10:00:00Z'), new Date('2026-12-15T17:59:59Z'))).toBe(0);
  });
});

describe('age calculation', () => {
  it('is exact on the boundary day', () => {
    expect(ageAt('1994-11-01', '2026-11-01')).toEqual({ years: 32, months: 0, days: 0 });
    expect(ageWithin(ageAt('1994-11-01', '2026-11-01')!, 32)).toBe(true);
  });

  it('is over the limit one day later', () => {
    const a = ageAt('1994-10-31', '2026-11-01')!;
    expect(a).toEqual({ years: 32, months: 0, days: 1 });
    expect(ageWithin(a, 32)).toBe(false);
  });

  it('handles month and year borrow', () => {
    expect(ageAt('2000-03-31', '2026-03-01')).toEqual({ years: 25, months: 11, days: 1 });
    // leap-day convention: attains the year on Feb 28 in common years (open legal item, plan UQ-12)
    expect(ageAt('2000-02-29', '2025-02-28')).toEqual({ years: 25, months: 0, days: 0 });
    expect(ageAt('2000-02-29', '2025-02-27')).toEqual({ years: 24, months: 11, days: 29 });
  });

  it('rejects dob after the reference date and invalid dates', () => {
    expect(ageAt('2030-01-01', '2026-11-01')).toBeNull();
    expect(ageAt('2000-02-31', '2026-11-01')).toBeNull();
    expect(ageAt('garbage', '2026-11-01')).toBeNull();
  });
});

describe('experience helpers', () => {
  it('counts whole months', () => {
    expect(monthsBetween('2024-01-15', '2025-01-14')).toBe(11);
    expect(monthsBetween('2024-01-15', '2025-01-15')).toBe(12);
  });

  it('sums overlapping ranges once', () => {
    const days = sumNonOverlappingDays([
      { from: '2024-01-01', to: '2024-01-10' },
      { from: '2024-01-05', to: '2024-01-20' },
      { from: '2024-03-01', to: '2024-03-02' },
    ]);
    expect(days).toBe(20 + 2);
  });

  it('ignores inverted ranges', () => {
    expect(sumNonOverlappingDays([{ from: '2024-02-01', to: '2024-01-01' }])).toBe(0);
  });
});
