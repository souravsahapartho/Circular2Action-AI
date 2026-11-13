import Link from 'next/link';
import { AdminShell } from '@/components/admin-shell';
import { Alert, Badge } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Opportunities' };

interface Row {
  id: string;
  title: string;
  organization: string;
  category_slug: string;
  publication_status: string;
  deadline_at: string | null;
  updated_at: string;
}

const TONE: Record<string, 'success' | 'neutral' | 'warn' | 'danger' | 'info'> = {
  published: 'success',
  draft: 'neutral',
  in_review: 'info',
  unpublished: 'warn',
  removed: 'danger',
};
const PAGE = 25;

export default async function AdminOpportunities({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const me = await requireStaff();
  const sp = await searchParams;
  const status = ['draft', 'in_review', 'published', 'unpublished', 'removed'].includes(
    sp.status ?? '',
  )
    ? sp.status
    : undefined;
  const q = (sp.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (status) qs.set('status', status);
  if (q) qs.set('q', q);
  const res = await apiGet<Row[]>(`/api/v1/admin/opportunities?${qs}`, { auth: true });
  const total = res.kind === 'ok' ? (res.total ?? res.data.length) : 0;
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { status, q: q || undefined, page: undefined, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    return `/admin/opportunities${p.toString() ? `?${p}` : ''}`;
  };
  return (
    <AdminShell
      me={me}
      active="opportunities"
      title="Opportunities"
      actions={
        <Link className="btn" href="/admin/opportunities/new">
          New opportunity
        </Link>
      }
    >
      <form className="row-flex" style={{ marginBottom: 16 }}>
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input
          id="q"
          name="q"
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Search title or organisation"
          defaultValue={q}
        />
        <label htmlFor="status" className="sr-only">
          Status
        </label>
        <select
          id="status"
          name="status"
          className="input"
          style={{ maxWidth: 200 }}
          defaultValue={status ?? ''}
        >
          <option value="">All statuses</option>
          {['draft', 'in_review', 'published', 'unpublished', 'removed'].map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <button className="btn secondary" type="submit">
          Filter
        </button>
      </form>
      {res.kind !== 'ok' ? (
        <Alert kind="error">Could not load opportunities. Reload in a moment.</Alert>
      ) : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Title</th>
              <th>Organisation</th>
              <th>Category</th>
              <th>Status</th>
              <th>Deadline</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {res.kind === 'ok' && res.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing here yet. Create the first draft with “New opportunity”.
                </td>
              </tr>
            ) : null}
            {res.kind === 'ok'
              ? res.data.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/opportunities/${o.id}`}>{o.title}</Link>
                    </td>
                    <td>{o.organization}</td>
                    <td>{o.category_slug}</td>
                    <td>
                      <Badge tone={TONE[o.publication_status] ?? 'neutral'}>
                        {o.publication_status}
                      </Badge>
                    </td>
                    <td className="tabular">{o.deadline_at ? o.deadline_at.slice(0, 10) : '–'}</td>
                    <td className="tabular">{o.updated_at.slice(0, 10)}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        {page > 1 ? (
          <Link className="btn secondary sm" href={link({ page: String(page - 1) })}>
            ← Previous
          </Link>
        ) : null}
        <span className="muted tabular">
          {total} total · page {page}
        </span>
        {page * PAGE < total ? (
          <Link className="btn secondary sm" href={link({ page: String(page + 1) })}>
            Next →
          </Link>
        ) : null}
      </div>
    </AdminShell>
  );
}
