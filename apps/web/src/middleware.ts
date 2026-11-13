import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, isLocale } from './i18n/config';

/** Every public page has a locale prefix (plan 8.1). Unprefixed paths go to the saved or default locale. */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const first = pathname.split('/')[1];
  if (isLocale(first)) return NextResponse.next();
  const saved = req.cookies.get('NEXT_LOCALE')?.value;
  const locale = isLocale(saved) ? saved : DEFAULT_LOCALE;
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api|api-health|_next|favicon.ico|robots.txt).*)'],
};
