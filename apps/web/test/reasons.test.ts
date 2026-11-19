import { describe, expect, it } from 'vitest';
import { getDictionary } from '../src/i18n/dictionaries';
import { reasonText } from '../src/lib/reasons';

describe('reasonText keeps a page in one language', () => {
  const en = getDictionary('en');
  const bn = getDictionary('bn');
  it('shows a matched word only when it is written in the page language', () => {
    expect(reasonText(en, { code: 'keyword', value: 'software' }, {}, 'en')).toBe(
      'Matches “software”',
    );
    expect(reasonText(bn, { code: 'keyword', value: 'এইচএসসি' }, {}, 'bn')).toContain('এইচএসসি');
  });
  it('uses a general sentence when the word is in the other language', () => {
    expect(reasonText(en, { code: 'keyword', value: 'এইচএসসি' }, {}, 'en')).toBe(
      'Matches your interests',
    );
    const bangla = reasonText(bn, { code: 'keyword', value: 'software' }, {}, 'bn')!;
    expect(bangla).toBe('আপনার আগ্রহের সাথে মিলেছে');
    expect(/[A-Za-z]/.test(bangla)).toBe(false);
  });
  it('category reasons use the translated category name', () => {
    expect(
      reasonText(en, { code: 'category_interest', value: 'jobs' }, { jobs: 'Jobs' }, 'en'),
    ).toContain('Jobs');
  });
});
