import Link from 'next/link';
import { AdminShell } from '@/components/admin-shell';
import { Alert } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Applications' };

interface Row {
  id: string;
  tracking_code: string;
  status: string;
  submitted_at: string;
  applicant_name: string;
  applicant_email: string;
  eligibility_status: string | null;
  opportunity: { id: string; title: string; organization: string };
}

const STATUSES = [
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
const ELIG: Record<string, string> = {
  eligible: 'Eligible',
  not_eligible: 'Not eligible',
  needs_verification: 'Needs verification',
  insufficient_information: 'Insufficient information',
};
const PAGE = 25;

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));

export default async function AdminApplications({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const me = await requireStaff();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? '') ? sp.status : undefined;
  const q = (sp.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (status) qs.set('status', status);
  if (q) qs.set('q', q);
  const res = await apiGet<Row[]>(`/api/v1/admin/applications?${qs}`, { auth: true });
  const counts = (res.kind === 'ok' ? res.meta?.counts : undefined) as
    Record<string, number> | undefined;
  const total = res.kind === 'ok' ? (res.total ?? res.data.length) : 0;
  const all = counts ? Object.values(counts).reduce((n, v) => n + v, 0) : 0;
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { status, q: q || undefined, page: undefined, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    return `/admin/applications${p.toString() ? `?${p}` : ''}`;
  };
  return (
    <AdminShell me={me} active="applications" title="Applications">
      <div className="chips" aria-label="Filter by status">
        <Link className="chip" href={link({ status: undefined })} aria-current={!status}>
          All <b>{all}</b>
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} className="chip" href={link({ status: s })} aria-current={status === s}>
            {STATUS_LABEL[s]} <b>{counts?.[s] ?? 0}</b>
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
          placeholder="Tracking ID, name, email or opportunity"
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
            No applications match. Applications appear here when people apply to an opportunity that
            accepts applications on the site (set in the opportunity form).
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tracking ID</th>
                <th>Applicant</th>
                <th>Opportunity</th>
                <th>Eligibility</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/admin/applications/${a.id}`}>
                      <code>{a.tracking_code}</code>
                    </Link>
                  </td>
                  <td>
                    {a.applicant_name}
                    <br />
                    <span className="muted small">{a.applicant_email}</span>
                  </td>
                  <td>
                    {a.opportunity.title}
                    <br />
                    <span className="muted small">{a.opportunity.organization}</span>
                  </td>
                  <td className="small">
                    {a.eligibility_status
                      ? (ELIG[a.eligibility_status] ?? a.eligibility_status)
                      : '–'}
                  </td>
                  <td>
                    <span className={`pill pill-${a.status}`}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="small">{fmt(a.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </AdminShell>
  );
}
