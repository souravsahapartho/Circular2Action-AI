import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { getMe, type Me } from '@/lib/session';
import { AccountMenu } from './account-menu';
import { MobileNav, type MobileItem } from './mobile-nav';
import { Icon, Logo } from './ui';

export type Section =
  | 'home'
  | 'explore'
  | 'search'
  | 'saved'
  | 'tracker'
  | 'profile'
  | 'dashboard'
  | 'settings'
  | 'other';

function navItems(
  locale: Locale,
  dict: Dictionary,
  me: Me | null,
): Array<MobileItem & { section: Section }> {
  const base: Array<MobileItem & { section: Section }> = [
    { href: `/${locale}`, label: dict.nav.home, icon: 'home', section: 'home' },
    {
      href: `/${locale}/opportunities`,
      label: dict.nav.explore,
      icon: 'briefcase',
      section: 'explore',
    },
    { href: `/${locale}/search`, label: dict.nav.search, icon: 'search', section: 'search' },
  ];
  if (me) {
    base.push(
      {
        href: `/${locale}/app`,
        label: dict.nav.dashboard,
        icon: 'dashboard',
        section: 'dashboard',
      },
      { href: `/${locale}/app/saved`, label: dict.nav.saved, icon: 'bookmark', section: 'saved' },
      { href: `/${locale}/app/tracker`, label: dict.nav.tracker, icon: 'list', section: 'tracker' },
      { href: `/${locale}/app/profile`, label: dict.nav.profile, icon: 'user', section: 'profile' },
      {
        href: `/${locale}/app/settings`,
        label: dict.nav.settings,
        icon: 'settings',
        section: 'settings',
      },
    );
  }
  return base;
}

function Header({
  locale,
  dict,
  section,
  path,
  me,
}: {
  locale: Locale;
  dict: Dictionary;
  section: Section;
  path: string;
  me: Me | null;
}) {
  const items = navItems(locale, dict, me);
  const desktop = items.filter((i) =>
    me
      ? ['explore', 'search', 'saved', 'tracker'].includes(i.section)
      : ['explore', 'search'].includes(i.section),
  );
  const switchPaths = { bn: `/bn${path}`, en: `/en${path}` };
  return (
    <header className="site-header">
      <div className="container">
        <Logo locale={locale} />
        <nav className="topnav" aria-label={dict.nav.primary}>
          {desktop.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={i.section === section ? 'page' : undefined}
            >
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <div className="lang-switch" role="group" aria-label={dict.nav.language}>
            <Link href={switchPaths.bn} lang="bn" hrefLang="bn" aria-current={locale === 'bn'}>
              বাংলা
            </Link>
            <Link href={switchPaths.en} lang="en" hrefLang="en" aria-current={locale === 'en'}>
              English
            </Link>
          </div>
          {me ? (
            <AccountMenu
              locale={locale}
              name={me.display_name}
              staff={me.staff}
              labels={{
                dashboard: dict.nav.dashboard,
                profile: dict.nav.profile,
                saved: dict.nav.saved,
                tracker: dict.nav.tracker,
                settings: dict.nav.settings,
                signOut: dict.nav.signOut,
                signIn: dict.nav.signIn,
                register: dict.nav.register,
                account: dict.nav.account,
              }}
            />
          ) : (
            <div className="header-auth">
              <Link href={`/${locale}/sign-in`} className="btn secondary sm">
                {dict.nav.signIn}
              </Link>
              <Link href={`/${locale}/register`} className="btn sm">
                {dict.nav.register}
              </Link>
            </div>
          )}
          <MobileNav
            locale={locale}
            items={items.map(({ href, label, icon }) => ({ href, label, icon }))}
            signedIn={me !== null}
            labels={{
              menu: dict.nav.menu,
              close: dict.nav.close,
              signIn: dict.nav.signIn,
              register: dict.nav.register,
              signOut: dict.nav.signOut,
              language: dict.nav.language,
            }}
            switchPaths={switchPaths}
          />
        </div>
      </div>
    </header>
  );
}

function TabBar({
  locale,
  dict,
  section,
  me,
}: {
  locale: Locale;
  dict: Dictionary;
  section: Section;
  me: Me | null;
}) {
  const cur = (s: Section[]) => (s.includes(section) ? ('page' as const) : undefined);
  return (
    <nav className="tabbar" aria-label={dict.nav.primary}>
      <Link href={`/${locale}`} aria-current={cur(['home'])}>
        <Icon name="home" />
        {dict.nav.home}
      </Link>
      <Link href={`/${locale}/opportunities`} aria-current={cur(['explore', 'search'])}>
        <Icon name="search" />
        {dict.nav.explore}
      </Link>
      <Link href={`/${locale}/app/tracker`} aria-current={cur(['tracker', 'saved'])}>
        <Icon name="list" />
        {dict.nav.tracker}
      </Link>
      <Link
        href={me ? `/${locale}/app` : `/${locale}/sign-in`}
        aria-current={cur(['dashboard', 'profile', 'settings'])}
      >
        <Icon name="user" />
        {me ? dict.nav.me : dict.nav.signIn}
      </Link>
    </nav>
  );
}

function Footer({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div style={{ gridColumn: 'span 2' }}>
            <Logo locale={locale} />
            <p style={{ marginTop: 12, maxWidth: '36ch' }}>{dict.footer.tagline}</p>
          </div>
          <div>
            <h4>{dict.footer.product}</h4>
            <ul>
              <li>
                <Link href={`/${locale}/opportunities`}>{dict.nav.explore}</Link>
              </li>
              <li>
                <Link href={`/${locale}/search`}>{dict.nav.search}</Link>
              </li>
              <li>
                <Link href={`/${locale}/app/tracker`}>{dict.nav.tracker}</Link>
              </li>
            </ul>
          </div>
          <div>
            <h4>{dict.footer.company}</h4>
            <ul>
              <li>
                <Link href={`/${locale}/about`}>{dict.footer.about}</Link>
              </li>
              <li>
                <Link href={`/${locale}/privacy`}>{dict.footer.privacy}</Link>
              </li>
              <li>
                <Link href={`/${locale}/terms`}>{dict.footer.terms}</Link>
              </li>
              <li>
                <Link href={`/${locale}/help`}>{dict.footer.help}</Link>
              </li>
              <li>
                <a href="/admin">{dict.footer.staff}</a>
              </li>
            </ul>
          </div>
        </div>
        <p className="footer-note">
          {dict.footer.note} {dict.footer.draft}
        </p>
      </div>
    </footer>
  );
}

/** Page shell: skip link, header (session aware), main, footer, mobile tab bar. */
export async function Page({
  locale,
  dict,
  section,
  path,
  children,
  me: meProp,
  bare,
}: {
  locale: Locale;
  dict: Dictionary;
  section: Section;
  path: string;
  children: ReactNode;
  /** pass an already-fetched user to avoid a second lookup */
  me?: Me | null;
  /** no container wrapper (the page lays out its own sections) */
  bare?: boolean;
}) {
  const me = meProp === undefined ? await getMe() : meProp;
  return (
    <>
      <a href="#main" className="skip">
        {dict.nav.skip}
      </a>
      <Header locale={locale} dict={dict} section={section} path={path} me={me} />
      <main id="main" tabIndex={-1}>
        {bare ? children : <div className="container">{children}</div>}
      </main>
      <Footer locale={locale} dict={dict} />
      <TabBar locale={locale} dict={dict} section={section} me={me} />
    </>
  );
}
