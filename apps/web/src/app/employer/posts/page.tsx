import Link from 'next/link';
import { Alert, Badge } from '@/components/ui';
import { EmployerShell } from '@/components/employer-shell';
import { apiGet } from '@/lib/api';
import { requireEmployer } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My posts' };

interface Row {
  id: string;
  title: string;
  category_slug: string;
  publication_status: string;
  deadline_at: string | null;
  updated_at: string;
  apply_mode: string;
  applications: number;
  saves: number;
}

const TONE: Record<string, 'success' | 'neutral' | 'warn' | 'danger' | 'info'> = {
  published: 'success',
  draft: 'neutral',
  in_review: 'info',
  unpublished: 'warn',
  removed: 'danger',
};
const LABEL: Record<string, string> = {
  published: 'Live',
  draft: 'Draft',
  in_review: 'In review',
  unpublished: 'Closed',
  removed: 'Removed',
};
const APPLY: Record<string, string> = {
  external: 'Official link',
  site: 'This site',
  both: 'Both',
};
const STATUSES = ['draft', 'in_review', 'published', 'unpublished'];

export default async function EmployerPosts({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const me = await requireEmployer();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? '') ? sp.status : undefined;
  const q = (sp.q ?? '').trim().slice(0, 200);
  const qs = new URLSearchParams({ limit: '50' });
  if (status) qs.set('status', status);
  if (q) qs.set('q', q);
  const [res, prof] = await Promise.all([
    apiGet<Row[]>(`/api/v1/employer/opportunities?${qs}`, { auth: true }),
    apiGet<{ company_name: string }>('/api/v1/employer/profile', { auth: true }),
  ]);
  const link = (s?: string) => `/employer/posts${s ? `?status=${s}` : ''}`;
  return (
    <EmployerShell
      me={me}
      company={prof.kind === 'ok' ? prof.data.company_name : ''}
      active="posts"
      title="My posts"
      actions={
        <Link className="btn" href="/employer/posts/new">
          New post
        </Link>
      }
    >
      <div className="chips">
        <Link className="chip" href={link()} aria-current={!status}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} className="chip" href={link(s)} aria-current={status === s}>
            {LABEL[s]}
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
          style={{ maxWidth: 320 }}
          placeholder="Search your posts"
          defaultValue={q}
        />
        <button className="btn secondary" type="submit">
          Search
        </button>
      </form>
      {res.kind !== 'ok' ? (
        <Alert kind="error">Could not load your posts. Reload in a moment.</Alert>
      ) : res.data.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Nothing here yet. Create your first post with “New post”.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Deadline</th>
                <th>Apply on</th>
                <th>Applications</th>
                <th>Saves</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/employer/posts/${o.id}`}>{o.title}</Link>
                    <br />
                    <span className="muted small">{o.category_slug}</span>
                  </td>
                  <td>
                    <Badge tone={TONE[o.publication_status] ?? 'neutral'}>
                      {LABEL[o.publication_status] ?? o.publication_status}
                    </Badge>
                  </td>
                  <td className="tabular">{o.deadline_at ? o.deadline_at.slice(0, 10) : '–'}</td>
                  <td className="small">{APPLY[o.apply_mode] ?? o.apply_mode}</td>
                  <td className="tabular">
                    {o.applications > 0 ? (
                      <Link href={`/employer/applications?q=${encodeURIComponent(o.title)}`}>
                        {o.applications}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="tabular">{o.saves}</td>
                  <td className="tabular">{o.updated_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EmployerShell>
  );
}
