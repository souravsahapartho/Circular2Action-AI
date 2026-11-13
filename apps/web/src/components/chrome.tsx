import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

type Section = 'home' | 'explore' | 'search' | 'tracker' | 'profile' | 'other';

export function TopBar({
  locale,
  dict,
  section,
  path,
}: {
  locale: Locale;
  dict: Dictionary;
  section: Section;
  /** current path without the locale prefix, for the language switch */
  path: string;
}) {
  const cur = (s: Section) => (s === section ? ('page' as const) : undefined);
  return (
    <header className="topbar">
      <div className="container">
        <Link href={`/${locale}`} className="logo" aria-label={dict.meta.title}>
          Circular<span>2</span>Action
        </Link>
        <nav className="topnav" aria-label={dict.nav.primary}>
          <Link href={`/${locale}/opportunities`} aria-current={cur('explore')}>
            {dict.nav.explore}
          </Link>
          <Link href={`/${locale}/search`} aria-current={cur('search')}>
            {dict.nav.search}
          </Link>
          <Link href={`/${locale}/app/tracker`} aria-current={cur('tracker')}>
            {dict.nav.tracker}
          </Link>
          <Link href={`/${locale}/app/profile`} aria-current={cur('profile')}>
            {dict.nav.profile}
          </Link>
        </nav>
        <div className="spacer" />
        <div className="lang-switch" role="group" aria-label={dict.nav.language}>
          <Link href={`/bn${path}`} lang="bn" hrefLang="bn" aria-current={locale === 'bn'}>
            বাংলা
          </Link>
          <Link href={`/en${path}`} lang="en" hrefLang="en" aria-current={locale === 'en'}>
            English
          </Link>
        </div>
        <Link href={`/${locale}/sign-in`} className="btn secondary">
          {dict.nav.signIn}
        </Link>
      </div>
    </header>
  );
}

export function TabBar({
  locale,
  dict,
  section,
}: {
  locale: Locale;
  dict: Dictionary;
  section: Section;
}) {
  const cur = (s: Section) => (s === section ? ('page' as const) : undefined);
  return (
    <nav className="tabbar" aria-label={dict.nav.primary}>
      <Link href={`/${locale}`} aria-current={cur('home')}>
        {dict.nav.home}
      </Link>
      <Link href={`/${locale}/search`} aria-current={cur('search')}>
        {dict.nav.search}
      </Link>
      <Link href={`/${locale}/app/tracker`} aria-current={cur('tracker')}>
        {dict.nav.tracker}
      </Link>
      <Link href={`/${locale}/app/profile`} aria-current={cur('profile')}>
        {dict.nav.me}
      </Link>
    </nav>
  );
}

export function Footer({ dict }: { dict: Dictionary }) {
  return (
    <footer className="site">
      <div className="container">
        <nav aria-label="Footer">
          <span>{dict.footer.about}</span>
          <span>{dict.footer.privacy}</span>
          <span>{dict.footer.terms}</span>
          <span>{dict.footer.help}</span>
        </nav>
        <p>{dict.footer.note}</p>
      </div>
    </footer>
  );
}

export function Page({
  locale,
  dict,
  section,
  path,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  section: Section;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <a href="#main" className="skip">
        {dict.nav.skip}
      </a>
      <TopBar locale={locale} dict={dict} section={section} path={path} />
      <main id="main">
        <div className="container">{children}</div>
      </main>
      <Footer dict={dict} />
      <TabBar locale={locale} dict={dict} section={section} />
    </>
  );
}
