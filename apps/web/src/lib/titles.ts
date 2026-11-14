const BENGALI = /[ঀ-৿]/;

/**
 * A circular's title is stored as written, with the other language in `title_alt`.
 * Show the one that matches the page language (same rule as the API's list and detail endpoints).
 */
export function titleFor(title: string, alt: string | null | undefined, locale: string): string {
  if (!alt) return title;
  const titleIsBengali = BENGALI.test(title);
  const altIsBengali = BENGALI.test(alt);
  if (locale === 'bn') return !titleIsBengali && altIsBengali ? alt : title;
  return titleIsBengali && !altIsBengali ? alt : title;
}
