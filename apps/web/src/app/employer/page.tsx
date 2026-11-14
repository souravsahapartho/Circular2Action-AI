import Link from 'next/link';
import { Alert } from '@/components/ui';
import { EmployerShell } from '@/components/employer-shell';
import { apiGet } from '@/lib/api';
import { requireEmployer } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

interface Overview {
  posts: Record<string, number>;
  applications: Record<string, number>;
  saves: number;
  top_posts: Array<{ id: string; title: string; applications: number; saves: number }>;
}
interface Profile {
  company_name: string;
  verification_status: string;
}
interface Recent {
  id: string;
  tracking_code: string;
  status: string;
  submitted_at: string;
  applicant_name: string;
  opportunity: { title: string };
}

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  accepted: 'Accepted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};
const ORDER = Object.keys(STATUS_LABEL);

export default async function EmployerHome() {
  const me = await requireEmployer();
  const [prof, ov, recent] = await Promise.all([
    apiGet<Profile>('/api/v1/employer/profile', { auth: true }),
    apiGet<Overview>('/api/v1/employer/overview', { auth: true }),
    apiGet<Recent[]>('/api/v1/employer/applications?limit=6', { auth: true }),
  ]);
  const company = prof.kind === 'ok' ? prof.data.company_name : 'Your company';
  const o = ov.kind === 'ok' ? ov.data : null;
  const posts = (s: string) => o?.posts[s] ?? 0;
  const apps = o?.applications ?? {};
  const total = Object.values(apps).reduce((n, v) => n + v, 0);
  const max = Math.max(1, ...ORDER.map((s) => apps[s] ?? 0));
  return (
    <EmployerShell
      me={me}
      company={company}
      active="overview"
      title="Dashboard"
      actions={
        <Link className="btn" href="/employer/posts/new">
          New post
        </Link>
      }
    >
      {ov.kind !== 'ok' ? (
        <Alert kind="error">
          Could not load the dashboard. The service may be waking up; reload in a moment.
        </Alert>
      ) : null}
      {prof.kind === 'ok' && prof.data.verification_status !== 'verified' ? (
        <Alert kind="info" role="note">
          Your company is not verified yet. Staff review each post before it goes live; a verified
          company is trusted faster.
        </Alert>
      ) : null}
      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <Link
          href="/employer/applications?status=submitted"
          className={`kpi${(apps.submitted ?? 0) > 0 ? ' warn' : ''}`}
        >
          <span className="label">Waiting for your review</span>
          <span className="value tabular">{apps.submitted ?? 0}</span>
          <span className="small muted">New applications</span>
        </Link>
        <Link href="/employer/applications" className="kpi">
          <span className="label">All applications</span>
          <span className="value tabular">{total}</span>
          <span className="small muted">To your posts</span>
        </Link>
        <Link href="/employer/posts?status=published" className="kpi">
          <span className="label">Live posts</span>
          <span className="value tabular">{posts('published')}</span>
          <span className="small muted">Visible on the site</span>
        </Link>
        <Link href="/employer/posts?status=in_review" className="kpi">
          <span className="label">In review</span>
          <span className="value tabular">{posts('in_review')}</span>
          <span className="small muted">Waiting for staff</span>
        </Link>
        <Link href="/employer/posts?status=draft" className="kpi">
          <span className="label">Drafts</span>
          <span className="value tabular">{posts('draft')}</span>
          <span className="small muted">Not sent yet</span>
        </Link>
        <div className="kpi">
          <span className="label">Saves</span>
          <span className="value tabular">{o?.saves ?? 0}</span>
          <span className="small muted">People saved your posts</span>
        </div>
      </div>

      <div className="panel-grid two" style={{ marginTop: 16 }}>
        <section className="panel">
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <h2>Recent applications</h2>
            <Link href="/employer/applications" className="small">
              See all
            </Link>
          </div>
          {recent.kind === 'ok' && recent.data.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Post</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/employer/applications/${a.id}`}>{a.applicant_name}</Link>
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
              No applications yet. Publish a post with “apply on this site” and applications appear
              here.
            </p>
          )}
        </section>
        <section className="panel">
          <h2>Applications by status</h2>
          {ORDER.map((s) => (
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

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Your most wanted posts</h2>
        {o && o.top_posts.length > 0 ? (
          <ol className="rank-list">
            {o.top_posts.map((p) => (
              <li key={p.id}>
                <Link href={`/employer/posts/${p.id}`}>{p.title}</Link>
                <span className="muted small">
                  {p.applications} applications · {p.saves} saves
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">
            Once a post is live, the ones people apply to and save most show here.
          </p>
        )}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>How it works</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            Create a <strong>post</strong> (a job, an internship or a circular) with its
            requirements and how people can apply.
          </li>
          <li>
            Send it for <strong>review</strong>. Staff check it and publish it; you see its status
            here.
          </li>
          <li>
            People apply on the site and get a <strong>tracking ID</strong>. You review each
            application and move it forward; applicants see every step.
          </li>
        </ol>
      </section>
    </EmployerShell>
  );
}
