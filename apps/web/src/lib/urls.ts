/** `/{locale}/opportunities/{slug}-{id}`: the trailing id is authoritative (plan 8.1). */
export function idFromSlug(slug: string): string | null {
  const m = /-(\d{1,20})$/.exec(slug) ?? /^(\d{1,20})$/.exec(slug);
  return m ? m[1]! : null;
}

/** Only http(s) links are ever rendered as links (a javascript: URL would run script). */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
