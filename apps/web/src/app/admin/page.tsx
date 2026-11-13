import Link from 'next/link';
import { AdminShell } from '@/components/admin-shell';
import { Alert } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };

interface Overview {
  opportunities: Record<string, number>;
  users: number;
  applications: number;
  organizations: number;
}

export default async function AdminHome() {
  const me = await requireStaff();
  const res = await apiGet<Overview>('/api/v1/admin/overview', { auth: true });
  const o = res.kind === 'ok' ? res.data : null;
  const count = (s: string) => o?.opportunities[s] ?? 0;
  const tiles: Array<[string, number | string, string?]> = [
    ['Published', count('published'), '/admin/opportunities?status=published'],
    ['Drafts', count('draft'), '/admin/opportunities?status=draft'],
    ['Unpublished', count('unpublished'), '/admin/opportunities?status=unpublished'],
    ['Organisations', o?.organizations ?? '–', '/admin/organizations'],
    ['Users', o?.users ?? '–', '/admin/users'],
    ['Tracked applications', o?.applications ?? '–'],
  ];
  return (
    <AdminShell
      me={me}
      active="overview"
      title="Overview"
      actions={
        <Link className="btn" href="/admin/opportunities/new">
          New opportunity
        </Link>
      }
    >
      {res.kind !== 'ok' ? (
        <Alert kind="error">
          Could not load the overview. The service may be waking up; reload in a moment.
        </Alert>
      ) : null}
      <div className="grid-cards">
        {tiles.map(([label, value, href]) => (
          <div key={label} className="card">
            <p className="muted small" style={{ margin: 0 }}>
              {label}
            </p>
            <p className="tabular" style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>
              {value}
            </p>
            {href ? <Link href={href}>Open</Link> : null}
          </div>
        ))}
      </div>
      <h2>How posting works</h2>
      <ol>
        <li>
          An editor creates a <strong>draft</strong> from an official circular, with the official
          link and requirements.
        </li>
        <li>
          A verifier checks it against the official circular and <strong>publishes</strong> it.
          Published items appear on the site at once.
        </li>
        <li>
          If the circular changes, <strong>unpublish</strong> or edit it. Every change is written to
          the audit log.
        </li>
      </ol>
    </AdminShell>
  );
}
