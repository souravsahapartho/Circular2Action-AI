import { hasPermission, type Permission, type Role } from '@c2a/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '@/lib/api';
import type { Me } from '@/lib/session';
import { AdminSignOut } from './admin-signout';
import { Icon, Logo, type IconName } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  perm: Permission;
  key: string;
}

const GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Workspace',
    items: [
      {
        href: '/admin',
        label: 'Dashboard',
        icon: 'dashboard',
        perm: 'admin.view',
        key: 'overview',
      },
      {
        href: '/admin/applications',
        label: 'Applications',
        icon: 'file',
        perm: 'application.read',
        key: 'applications',
      },
      {
        href: '/admin/opportunities',
        label: 'Opportunities',
        icon: 'briefcase',
        perm: 'opportunity.read',
        key: 'opportunities',
      },
      {
        href: '/admin/listings',
        label: 'Web listings',
        icon: 'globe',
        perm: 'listing.manage',
        key: 'listings',
      },
    ],
  },
  {
    title: 'Directory',
    items: [
      {
        href: '/admin/organizations',
        label: 'Organisations',
        icon: 'building',
        perm: 'organization.manage',
        key: 'organizations',
      },
      { href: '/admin/users', label: 'Users', icon: 'users', perm: 'user.read', key: 'users' },
    ],
  },
  {
    title: 'Compliance',
    items: [
      {
        href: '/admin/audit',
        label: 'Audit log',
        icon: 'shield',
        perm: 'audit.view',
        key: 'audit',
      },
    ],
  },
];

/** Staff portal layout: its own navigation (permission filtered), pending-work badge and sign out. */
export async function AdminShell({
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
  let pending = 0;
  if (hasPermission(roles, 'application.read')) {
    const res = await apiGet<unknown[]>('/api/v1/admin/applications?limit=1', {
      auth: true,
      timeoutMs: 8000,
    });
    if (res.kind === 'ok') {
      const counts = res.meta?.counts as Record<string, number> | undefined;
      pending = counts?.submitted ?? 0;
    }
  }
  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <Logo locale="en" />
        <span className="portal-tag">Staff portal</span>
        <nav aria-label="Staff navigation">
          {GROUPS.map((g) => {
            const items = g.items.filter((n) => hasPermission(roles, n.perm));
            if (items.length === 0) return null;
            return (
              <div key={g.title} style={{ display: 'contents' }}>
                <p className="nav-group">{g.title}</p>
                {items.map((n) => (
                  <Link
                    key={n.key}
                    href={n.href}
                    className="nav"
                    aria-current={n.key === active ? 'page' : undefined}
                  >
                    <Icon name={n.icon} /> {n.label}
                    {n.key === 'applications' && pending > 0 ? (
                      <span className="nav-badge" title="Waiting for review">
                        {pending}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            );
          })}
          <p className="nav-group">Site</p>
          <Link href="/en" className="nav">
            <Icon name="home" /> View public site
          </Link>
        </nav>
        <div className="who">
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
