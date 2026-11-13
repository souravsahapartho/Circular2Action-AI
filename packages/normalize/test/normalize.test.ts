import { describe, expect, it } from 'vitest';
import {
  foldDigits,
  normalizeForMatch,
  normalizeReferenceNo,
  slugify,
  tokenize,
  trigrams,
} from '../src/index';

describe('normalize', () => {
  it('folds Bangla digits to ASCII', () => {
    expect(foldDigits('১৫ ডিসেম্বর ২০২৬')).toBe('15 ডিসেম্বর 2026');
  });

  it('makes Bangla-digit and Latin-digit queries equal', () => {
    expect(normalizeForMatch('বিজ্ঞপ্তি ২০২৬')).toBe(normalizeForMatch('বিজ্ঞপ্তি 2026'));
  });

  it('removes ZWJ/ZWNJ for matching only', () => {
    expect(normalizeForMatch('ক্‍ষ')).toBe('ক্ষ');
    expect(normalizeForMatch('আবেদন‌কারী')).toBe(normalizeForMatch('আবেদনকারী'));
  });

  it('applies NFC so decomposed vowel signs match precomposed ones', () => {
    const decomposed = 'দো'; // not a real word; checks canonical equivalence handling
    expect(normalizeForMatch(decomposed)).toBe(decomposed.normalize('NFC'));
    // য় (U+09DF) vs য + nukta (U+09AF U+09BC)
    expect(normalizeForMatch('য়')).toBe(normalizeForMatch('য়'));
  });

  it('lower-cases Latin, strips punctuation, collapses whitespace', () => {
    expect(normalizeForMatch('  Assistant   Programmer, (BPSC)!  ')).toBe(
      'assistant programmer bpsc',
    );
  });

  it('handles mixed Bangla and English', () => {
    expect(tokenize('সহকারী Programmer পদ ৪টি')).toEqual(['সহকারী', 'programmer', 'পদ', '4টি']);
  });

  it('returns empty arrays for empty or punctuation-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!!! ---')).toEqual([]);
  });

  it('produces trigrams that include boundary markers', () => {
    expect(trigrams('abc')).toEqual(['  a', ' ab', 'abc', 'bc ']);
  });

  it('normalises reference numbers for duplicate detection', () => {
    expect(normalizeReferenceNo('৩৭.০০.০০০০.১২৩ / 2026')).toBe('37000000123' + '2026');
    expect(normalizeReferenceNo('MoE-12/2026')).toBe('moe122026');
  });

  it('slugifies Bangla and Latin titles and caps length', () => {
    expect(slugify('Assistant Programmer — Example Directorate')).toBe(
      'assistant-programmer-example-directorate',
    );
    expect(slugify('সহকারী প্রোগ্রামার')).toBe('সহকারী-প্রোগ্রামার');
    expect(slugify('a'.repeat(200)).length).toBe(80);
  });

  it('handles very long organisation names without throwing', () => {
    const long = 'বাংলাদেশ '.repeat(200);
    expect(normalizeForMatch(long).length).toBeGreaterThan(0);
  });
});
