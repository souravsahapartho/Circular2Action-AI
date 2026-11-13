import { hasPermission, type Permission, type Role } from '@c2a/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Me } from '@/lib/session';
import { AdminSignOut } from './admin-signout';
import { Icon, Logo, type IconName } from './ui';

const NAV: Array<{ href: string; label: string; icon: IconName; perm: Permission; key: string }> = [
  { href: '/admin', label: 'Overview', icon: 'dashboard', perm: 'admin.view', key: 'overview' },
  {
    href: '/admin/opportunities',
    label: 'Opportunities',
    icon: 'briefcase',
    perm: 'opportunity.read',
    key: 'opportunities',
  },
  {
    href: '/admin/organizations',
    label: 'Organisations',
    icon: 'building',
    perm: 'organization.manage',
    key: 'organizations',
  },
  { href: '/admin/users', label: 'Users', icon: 'users', perm: 'user.read', key: 'users' },
  { href: '/admin/audit', label: 'Audit log', icon: 'shield', perm: 'audit.view', key: 'audit' },
];

/** Staff layout: dark side navigation, permission-filtered, with sign out. */
export function AdminShell({
  me,
  active,
  title,
  actions,
  children,
}: {
  me: Me;
  active: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const roles = me.roles as Role[];
  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <Logo locale="en" />
        <p className="small" style={{ color: 'var(--brand-100)', margin: '8px 0 0' }}>
          Staff area
        </p>
        <nav aria-label="Staff navigation">
          {NAV.filter((n) => hasPermission(roles, n.perm)).map((n) => (
            <Link
              key={n.key}
              href={n.href}
              className="nav"
              aria-current={n.key === active ? 'page' : undefined}
            >
              <Icon name={n.icon} /> {n.label}
            </Link>
          ))}
          <Link href="/en" className="nav">
            <Icon name="globe" /> View site
          </Link>
        </nav>
        <div style={{ marginTop: 24 }}>
          <p className="small" style={{ color: 'var(--brand-100)', margin: '0 0 8px' }}>
            {me.display_name}
            <br />
            <span style={{ opacity: 0.8 }}>{me.roles.filter((r) => r !== 'user').join(', ')}</span>
          </p>
          <AdminSignOut />
        </div>
      </aside>
      <div className="admin-main">
        <main id="main" tabIndex={-1} style={{ padding: 0 }}>
          <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
            <h1 style={{ margin: 0 }}>{title}</h1>
            {actions}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
