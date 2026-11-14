import { hasPermission, type Role } from '@c2a/contracts';
import Link from 'next/link';
import { AdminShell } from '@/components/admin-shell';
import { AdminCharts, type Analytics } from '@/components/admin-charts';
import { Alert } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

interface Overview {
  opportunities: Record<string, number>;
  users: number;
  applications: number;
  organizations: number;
  site_applications?: Record<string, number>;
  web_listings?: number;
}

interface Recent {
  id: string;
  tracking_code: string;
  status: string;
  submitted_at: string;
  applicant_name: string;
  applicant_email: string;
  opportunity: { title: string };
}

const STATUS_ORDER = [
  'submitted',
  'under_review',
  'shortlisted',
  'interview',
  'accepted',
  'rejected',
  'withdrawn',
];
const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  accepted: 'Accepted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};

export default async function AdminHome() {
  const me = await requireStaff();
  const roles = me.roles as Role[];
  const canApps = hasPermission(roles, 'application.read');
  const canStats = hasPermission(roles, 'analytics.view');
  const [res, recent, stats] = await Promise.all([
    apiGet<Overview>('/api/v1/admin/overview', { auth: true }),
    canApps
      ? apiGet<Recent[]>('/api/v1/admin/applications?limit=6', { auth: true })
      : Promise.resolve(null),
    canStats ? apiGet<Analytics>('/api/v1/admin/analytics', { auth: true }) : Promise.resolve(null),
  ]);
  const o = res.kind === 'ok' ? res.data : null;
  const count = (s: string) => o?.opportunities[s] ?? 0;
  const apps = o?.site_applications ?? {};
  const appTotal = Object.values(apps).reduce((n, v) => n + v, 0);
  const max = Math.max(1, ...STATUS_ORDER.map((s) => apps[s] ?? 0));
  return (
    <AdminShell
      me={me}
      active="overview"
      title="Dashboard"
      actions={
        hasPermission(roles, 'opportunity.write') ? (
          <Link className="btn" href="/admin/opportunities/new">
            New opportunity
          </Link>
        ) : null
      }
    >
      {res.kind !== 'ok' ? (
        <Alert kind="error">
          Could not load the dashboard. The service may be waking up; reload in a moment.
        </Alert>
      ) : null}

      <div className="kpi-grid">
        {canApps ? (
          <Link
            href="/admin/applications?status=submitted"
            className={`kpi${(apps.submitted ?? 0) > 0 ? ' warn' : ''}`}
          >
            <span className="label">Waiting for review</span>
            <span className="value tabular">{apps.submitted ?? 0}</span>
            <span className="small muted">New applications</span>
          </Link>
        ) : null}
        {canApps ? (
          <Link href="/admin/applications" className="kpi">
            <span className="label">All applications</span>
            <span className="value tabular">{appTotal}</span>
            <span className="small muted">Made through the site</span>
          </Link>
        ) : null}
        <Link href="/admin/opportunities?status=published" className="kpi">
          <span className="label">Published</span>
          <span className="value tabular">{count('published')}</span>
          <span className="small muted">Live opportunities</span>
        </Link>
        <Link href="/admin/opportunities?status=draft" className="kpi">
          <span className="label">Drafts</span>
          <span className="value tabular">{count('draft')}</span>
          <span className="small muted">Not yet published</span>
        </Link>
        {hasPermission(roles, 'listing.manage') ? (
          <Link href="/admin/listings" className="kpi">
            <span className="label">Web listings</span>
            <span className="value tabular">{o?.web_listings ?? '–'}</span>
            <span className="small muted">Fetched from the web</span>
          </Link>
        ) : null}
        <div className="kpi">
          <span className="label">Users</span>
          <span className="value tabular">{o?.users ?? '–'}</span>
          <span className="small muted">{o?.organizations ?? '–'} organisations</span>
        </div>
      </div>

      <div className="quick-actions" style={{ marginTop: 16 }}>
        {hasPermission(roles, 'opportunity.write') ? (
          <Link className="btn secondary" href="/admin/opportunities/new">
            New opportunity
          </Link>
        ) : null}
        {canApps ? (
          <a className="btn secondary" href="/api/v1/admin/applications/export">
            Export applications (CSV)
          </a>
        ) : null}
        {hasPermission(roles, 'system.operate') ? (
          <Link className="btn secondary" href="/admin/announcements">
            Send an announcement
          </Link>
        ) : null}
        {hasPermission(roles, 'listing.manage') ? (
          <Link className="btn secondary" href="/admin/listings">
            Refresh web jobs
          </Link>
        ) : null}
      </div>

      {stats && stats.kind === 'ok' ? <AdminCharts a={stats.data} /> : null}

      {canApps ? (
        <div className="panel-grid two" style={{ marginTop: 16 }}>
          <section className="panel">
            <div className="row-flex" style={{ justifyContent: 'space-between' }}>
              <h2>Recent applications</h2>
              <Link href="/admin/applications" className="small">
                See all
              </Link>
            </div>
            {recent && recent.kind === 'ok' && recent.data.length > 0 ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Applicant</th>
                      <th>Opportunity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.data.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/admin/applications/${a.id}`}>{a.applicant_name}</Link>
                          <br />
                          <code className="small">{a.tracking_code}</code>
                        </td>
                        <td>{a.opportunity.title}</td>
                        <td>
                          <span className={`pill pill-${a.status}`}>
                            {STATUS_LABEL[a.status] ?? a.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                No applications yet. Set an opportunity to accept applications on the site and they
                appear here.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Applications by status</h2>
            {STATUS_ORDER.map((s) => (
              <div key={s} className="bar-row">
                <span>{STATUS_LABEL[s]}</span>
                <span className="bar">
                  <span style={{ width: `${((apps[s] ?? 0) / max) * 100}%` }} />
                </span>
                <span className="tabular">{apps[s] ?? 0}</span>
              </div>
            ))}
          </section>
        </div>
      ) : null}

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>How the work flows</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            An editor creates a <strong>draft</strong> from an official circular (official link,
            requirements, and whether people can <strong>apply on the site</strong>).
          </li>
          <li>
            A verifier checks it against the circular and <strong>publishes</strong> it. It is live
            at once.
          </li>
          <li>
            When people apply, each application gets a <strong>tracking ID</strong>. Staff review it
            here and move it forward; the applicant sees the status on their page and on the
            tracking page.
          </li>
          <li>Every staff change is written to the audit log.</li>
        </ol>
      </section>
    </AdminShell>
  );
}
