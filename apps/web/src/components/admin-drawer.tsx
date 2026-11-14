'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, Logo } from './ui';

/**
 * Staff portal chrome for small screens: a top bar with a menu button, and the side navigation as a slide-in
 * drawer. On wide screens the navigation is a fixed sidebar and the top bar is hidden (CSS only).
 * It also gives every data table the column titles it needs to turn into stacked cards on phones.
 */
export function AdminDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
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

  // label every cell with its column title, now and whenever rows change, so phones can show "Title: value"
  useEffect(() => {
    const label = () => {
      document.querySelectorAll('table.data').forEach((t) => {
        const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
        t.querySelectorAll('tbody tr').forEach((tr) =>
          [...tr.children].forEach((td, i) => {
            const h = heads[i] ?? '';
            if (td.getAttribute('data-label') !== h) td.setAttribute('data-label', h);
          }),
        );
      });
    };
    label();
    const main = document.getElementById('main');
    if (!main) return;
    const obs = new MutationObserver(label);
    obs.observe(main, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [pathname]);

  return (
    <>
      <header className="admin-mobilebar">
        <button
          type="button"
          className="btn ghost"
          aria-label="Open the staff menu"
          aria-expanded={open}
          aria-controls="admin-side"
          onClick={() => setOpen(true)}
          style={{ padding: 8 }}
        >
          <Icon name="menu" size="lg" />
        </button>
        <Logo locale="en" />
        <span className="portal-tag-sm">Staff</span>
      </header>
      {open ? <div className="admin-scrim" onClick={() => setOpen(false)} /> : null}
      <aside id="admin-side" className={`admin-side${open ? ' open' : ''}`}>
        <button
          type="button"
          className="btn ghost sm admin-close"
          aria-label="Close the staff menu"
          onClick={() => setOpen(false)}
        >
          <Icon name="x" />
        </button>
        {children}
      </aside>
    </>
  );
}
