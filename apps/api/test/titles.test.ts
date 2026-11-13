import { describe, expect, it } from 'vitest';
import { textFor, titleFor } from '../src/modules/opportunities/repo';

describe('language-aware titles and requirement text', () => {
  it('shows the title in the page language when the alternate title is the other language', () => {
    expect(titleFor('[নমুনা] অফিস সহায়ক', '[Sample] Office Assistant', 'en')).toBe(
      '[Sample] Office Assistant',
    );
    expect(titleFor('[নমুনা] অফিস সহায়ক', '[Sample] Office Assistant', 'bn')).toBe(
      '[নমুনা] অফিস সহায়ক',
    );
    expect(titleFor('Assistant Engineer', 'সহকারী প্রকৌশলী', 'bn')).toBe('সহকারী প্রকৌশলী');
    expect(titleFor('Only title', null, 'bn')).toBe('Only title');
  });

  it('splits "বাংলা / English" requirement text by locale and leaves other text alone', () => {
    const t = 'বয়স সর্বোচ্চ ৩০ বছর / Age at most 30 years';
    expect(textFor(t, 'bn')).toBe('বয়স সর্বোচ্চ ৩০ বছর');
    expect(textFor(t, 'en')).toBe('Age at most 30 years');
    expect(textFor('Plain text / with slash', 'en')).toBe('Plain text / with slash');
    expect(textFor(null, 'en')).toBeNull();
  });
});
