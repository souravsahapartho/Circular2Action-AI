export const LOCALES = ['bn', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'bn';

export function isLocale(v: string | undefined): v is Locale {
  return v === 'bn' || v === 'en';
}

/** Intl locale per UI language: Bangla digits in the Bangla UI (plan section 7.2). */
export const INTL_LOCALE: Record<Locale, string> = { bn: 'bn-BD', en: 'en-GB' };

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(n);
}

/** Whole days from `now` until `iso` in Dhaka time; negative when past. */
export function daysUntil(iso: string, now: Date): number {
  const day = (d: Date) =>
    Date.UTC(
      ...(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .format(d)
        .split('-')
        .map(Number)
        .map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]),
    );
  return Math.round((day(new Date(iso)) - day(now)) / 86_400_000);
}
