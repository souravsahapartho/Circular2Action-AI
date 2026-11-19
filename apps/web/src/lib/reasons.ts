import { t, type Dictionary } from '@/i18n/dictionaries';

export interface Reason {
  code: string;
  value?: string;
}

/** The sentence for one reason chip ("You chose Jobs", "Matches “software”"), or null for an unknown code. */
export function reasonText(
  d: Dictionary,
  r: Reason,
  categoryNames: Record<string, string>,
  locale: 'bn' | 'en' = 'en',
): string | null {
  let text = (d.forYou as Record<string, string>)[`r_${r.code}`];
  if (!text) return null;
  // A matched word can come from either language of an opportunity. Show it only when it is written in the page's
  // language (Bangla letters on a Bangla page, Latin letters on an English page); otherwise say it in general terms,
  // so a page is never half in one language and half in the other.
  if (r.code === 'keyword') {
    const hasBangla = /[\u0980-\u09FF]/.test(r.value ?? '');
    const sameScript = locale === 'bn' ? hasBangla : !hasBangla;
    if (!sameScript) text = (d.forYou as Record<string, string>).r_keyword_general ?? text;
  }
  const value = r.code.startsWith('category')
    ? (categoryNames[r.value ?? ''] ?? r.value ?? '')
    : (r.value ?? '');
  return t(text, { value });
}
