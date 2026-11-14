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
): string | null {
  const text = (d.forYou as Record<string, string>)[`r_${r.code}`];
  if (!text) return null;
  const value = r.code.startsWith('category')
    ? (categoryNames[r.value ?? ''] ?? r.value ?? '')
    : (r.value ?? '');
  return t(text, { value });
}
