import { describe, expect, it } from 'vitest';
import bn from '../src/i18n/bn.json';
import en from '../src/i18n/en.json';
import { daysUntil, formatDate, formatNumber, isLocale } from '../src/i18n/config';
import { t } from '../src/i18n/dictionaries';

function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('Bangla and English dictionaries have exactly the same keys', () => {
    expect(keys(bn).sort()).toEqual(keys(en).sort());
  });

  it('no empty strings and placeholders match per key', () => {
    const flat = (o: object, p = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object'
          ? flat(v, `${p}${k}.`)
          : [[`${p}${k}`, String(v)] as [string, string]],
      );
    const enMap = new Map(flat(en));
    for (const [k, v] of flat(bn)) {
      expect(v.trim(), k).not.toBe('');
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(v), k).toEqual(ph(enMap.get(k)!));
    }
  });

  it('formats numbers and dates with Bangla digits in the Bangla UI', () => {
    expect(formatNumber(2026, 'bn')).toBe('২,০২৬');
    expect(formatNumber(2026, 'en')).toBe('2,026');
    expect(formatDate('2026-12-01T00:00:00+06:00', 'bn')).toMatch(/১/);
    expect(formatDate('2026-12-01T00:00:00+06:00', 'en')).toBe('1 December 2026');
  });

  it('counts days in Dhaka time', () => {
    const now = new Date('2026-11-13T20:00:00Z'); // 14 Nov 02:00 in Dhaka
    expect(daysUntil('2026-11-14T17:00:00Z', now)).toBe(0); // 14 Nov 23:00 Dhaka
    expect(daysUntil('2026-11-20T00:00:00+06:00', now)).toBe(6);
    expect(daysUntil('2026-11-10T00:00:00+06:00', now)).toBe(-4);
  });

  it('template replacement and locale guard', () => {
    expect(t('{n} days', { n: 3 })).toBe('3 days');
    expect(isLocale('bn')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });
});
