import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '@/lib/api';
import type { Me } from '@/lib/session';
import { AdminDrawer } from './admin-drawer';
import { AdminSignOut } from './admin-signout';
import { Icon, Logo, type IconName } from './ui';

const NAV: Array<{ href: string; label: string; icon: IconName; key: string }> = [
  { href: '/employer', label: 'Dashboard', icon: 'dashboard', key: 'overview' },
  { href: '/employer/posts', label: 'My posts', icon: 'briefcase', key: 'posts' },
  { href: '/employer/applications', label: 'Applications', icon: 'file', key: 'applications' },
  { href: '/employer/notifications', label: 'Notifications', icon: 'bell', key: 'notifications' },
  { href: '/employer/company', label: 'Company', icon: 'building', key: 'company' },
];

/** Employer (recruiter) portal layout: the same responsive chrome as the staff portal, with employer navigation. */
export async function EmployerShell({
  me,
  company,
  active,
  title,
  actions,
  children,
}: {
  me: Me;
  company: string;
  active: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  let waiting = 0;
  let unread = 0;
  const bell = await apiGet<{ unread: number }>('/api/v1/me/notifications/unread-count', {
    auth: true,
    timeoutMs: 8000,
  });
  if (bell.kind === 'ok') unread = bell.data.unread;
  const res = await apiGet<unknown[]>('/api/v1/employer/applications?limit=1', {
    auth: true,
    timeoutMs: 8000,
  });
  if (res.kind === 'ok') {
    const counts = res.meta?.counts as Record<string, number> | undefined;
    waiting = counts?.submitted ?? 0;
  }
  return (
    <div className="admin-shell employer-shell">
      <AdminDrawer>
        <Logo locale="en" />
        <span className="portal-tag">Employer portal</span>
        <nav aria-label="Employer navigation">
          <p className="nav-group">{company}</p>
          {NAV.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              className="nav"
              aria-current={n.key === active ? 'page' : undefined}
            >
              <Icon name={n.icon} /> {n.label}
              {n.key === 'notifications' && unread > 0 ? (
                <span className="nav-badge" title="Unread">
                  {unread}
                </span>
              ) : null}
              {n.key === 'applications' && waiting > 0 ? (
                <span className="nav-badge" title="Waiting for your review">
                  {waiting}
                </span>
              ) : null}
            </Link>
          ))}
          <p className="nav-group">Site</p>
          <Link href="/en" className="nav">
            <Icon name="home" /> View public site
          </Link>
        </nav>
        <div className="who">
          <p className="small" style={{ color: 'var(--brand-100)', margin: '0 0 8px' }}>
            {me.display_name}
            <br />
            <span style={{ opacity: 0.8 }}>{me.email}</span>
          </p>
          <AdminSignOut to="/employer/login" />
        </div>
      </AdminDrawer>
      <div className="admin-main">
        <main id="main" tabIndex={-1} style={{ padding: 0 }}>
          <div className="admin-topbar">
            <h1>{title}</h1>
            <div className="row-flex">{actions}</div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
