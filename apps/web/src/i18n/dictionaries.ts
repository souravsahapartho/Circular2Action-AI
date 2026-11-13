import bn from './bn.json';
import en from './en.json';
import type { Locale } from './config';

export type Dictionary = typeof en;
const DICTS: Record<Locale, Dictionary> = { bn, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTS[locale];
}

/** Replaces `{name}` placeholders. */
export function t(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
