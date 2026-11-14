import Link from 'next/link';
import { Alert } from '@/components/ui';
import { EmployerShell } from '@/components/employer-shell';
import { apiGet } from '@/lib/api';
import { requireEmployer } from '@/lib/session';
import { ApplicationsTable, type AppRow } from '../../admin/applications/applications-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Applications' };

const STATUSES = [
  'submitted',
  'under_review',
  'shortlisted',
  'interview',
  'accepted',
  'rejected',
  'withdrawn',
];
const LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  accepted: 'Accepted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};
const PAGE = 25;

export default async function EmployerApplications({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const me = await requireEmployer();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? '') ? sp.status : undefined;
  const q = (sp.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (status) qs.set('status', status);
  if (q) qs.set('q', q);
  const [res, prof] = await Promise.all([
    apiGet<AppRow[]>(`/api/v1/employer/applications?${qs}`, { auth: true }),
    apiGet<{ company_name: string }>('/api/v1/employer/profile', { auth: true }),
  ]);
  const counts = (res.kind === 'ok' ? res.meta?.counts : undefined) as
    Record<string, number> | undefined;
  const total = res.kind === 'ok' ? (res.total ?? res.data.length) : 0;
  const all = counts ? Object.values(counts).reduce((n, v) => n + v, 0) : 0;
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { status, q: q || undefined, page: undefined, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    return `/employer/applications${p.toString() ? `?${p}` : ''}`;
  };
  return (
    <EmployerShell
      me={me}
      company={prof.kind === 'ok' ? prof.data.company_name : ''}
      active="applications"
      title="Applications"
    >
      <div className="chips" aria-label="Filter by status">
        <Link className="chip" href={link({ status: undefined })} aria-current={!status}>
          All <b>{all}</b>
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} className="chip" href={link({ status: s })} aria-current={status === s}>
            {LABEL[s]} <b>{counts?.[s] ?? 0}</b>
          </Link>
        ))}
      </div>
      <form className="row-flex" style={{ marginBottom: 16 }}>
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input
          id="q"
          name="q"
          className="input"
          style={{ maxWidth: 380 }}
          placeholder="Tracking ID, name, email or post"
          defaultValue={q}
        />
        <button className="btn secondary" type="submit">
          Search
        </button>
      </form>
      {res.kind !== 'ok' ? (
        <Alert kind="error">Could not load applications. Reload in a moment.</Alert>
      ) : res.data.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            No applications match. They appear here when people apply to a live post that accepts
            applications on this site.
          </p>
        </div>
      ) : (
        <ApplicationsTable rows={res.data} canManage={false} basePath="/employer/applications" />
      )}
      {res.kind === 'ok' && total > PAGE ? (
        <nav className="pagination" aria-label="Pagination" style={{ marginTop: 16 }}>
          {page > 1 ? (
            <Link className="btn secondary sm" href={link({ page: String(page - 1) })}>
              ← Previous
            </Link>
          ) : null}
          <span className="muted tabular">
            {page} / {Math.ceil(total / PAGE)}
          </span>
          {page * PAGE < total ? (
            <Link className="btn secondary sm" href={link({ page: String(page + 1) })}>
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </EmployerShell>
  );
}
