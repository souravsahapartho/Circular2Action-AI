/** Only same-site paths are accepted as a post-login destination (no open redirects). */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (
    !next ||
    !/^\/(bn|en|admin)(\/|$|\?)/.test(next) ||
    next.includes('//') ||
    next.includes('\\')
  ) {
    return fallback;
  }
  return next;
}
