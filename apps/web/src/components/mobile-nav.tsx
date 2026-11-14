'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { signOut } from './account-menu';
import { Icon, type IconName } from './ui';

export interface MobileItem {
  href: string;
  label: string;
  icon: IconName;
}

export function MobileNav({
  locale,
  items,
  signedIn,
  labels,
  switchPaths,
}: {
  locale: string;
  items: MobileItem[];
  signedIn: boolean;
  labels: {
    menu: string;
    close: string;
    signIn: string;
    register: string;
    signOut: string;
    language: string;
  };
  switchPaths: { bn: string; en: string };
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="btn ghost menu-button"
        aria-label={labels.menu}
        aria-expanded={open}
        aria-controls="mobile-drawer"
        onClick={() => setOpen(true)}
        style={{ padding: '8px' }}
      >
        <Icon name="menu" size="lg" />
      </button>
      {open && mounted
        ? createPortal(
            <>
              <div className="drawer-backdrop" onClick={() => setOpen(false)} />
              <nav id="mobile-drawer" className="drawer" aria-label={labels.menu}>
                <div
                  className="row-flex"
                  style={{ justifyContent: 'space-between', marginBottom: 8 }}
                >
                  <strong>{labels.menu}</strong>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setOpen(false)}
                    aria-label={labels.close}
                  >
                    <Icon name="x" />
                  </button>
                </div>
                {items.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={pathname === it.href ? 'page' : undefined}
                  >
                    <Icon name={it.icon} /> {it.label}
                  </Link>
                ))}
                <hr
                  style={{
                    border: 0,
                    borderTop: '1px solid var(--line-200)',
                    width: '100%',
                    margin: '8px 0',
                  }}
                />
                {signedIn ? (
                  <button type="button" className="link" onClick={() => void signOut(locale)}>
                    <Icon name="logout" /> {labels.signOut}
                  </button>
                ) : (
                  <>
                    <Link href={`/${locale}/sign-in`}>
                      <Icon name="user" /> {labels.signIn}
                    </Link>
                    <Link href={`/${locale}/register`}>
                      <Icon name="plus" /> {labels.register}
                    </Link>
                  </>
                )}
                <div
                  className="row-flex"
                  style={{ padding: '8px 12px' }}
                  role="group"
                  aria-label={labels.language}
                >
                  <Icon name="globe" />
                  <Link
                    href={switchPaths.bn}
                    lang="bn"
                    hrefLang="bn"
                    style={{ padding: '4px 8px' }}
                  >
                    বাংলা
                  </Link>
                  <Link
                    href={switchPaths.en}
                    lang="en"
                    hrefLang="en"
                    style={{ padding: '4px 8px' }}
                  >
                    English
                  </Link>
                </div>
              </nav>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
