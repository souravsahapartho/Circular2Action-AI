import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasPermission, type Role } from '@c2a/contracts';
import { AdminShell } from '@/components/admin-shell';
import { Badge } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';
import { SponsoredActions, StartDemo } from './sponsored-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sponsored posts' };

interface Row {
  id: string;
  opportunity_id: string;
  title: string;
  company: string | null;
  owner: string | null;
  days: number;
  status: 'pending' | 'active' | 'rejected' | 'ended';
  note: string | null;
  ends_at: string | null;
  impressions: number;
  clicks: number;
  created_at: string;
}

const TONE = { pending: 'warn', active: 'success', rejected: 'danger', ended: 'neutral' } as const;
const STATUSES = ['pending', 'active', 'ended', 'rejected'] as const;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '–');

export default async function SponsoredPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await requireStaff();
  if (!hasPermission(me.roles as Role[], 'listing.manage')) redirect('/admin');
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status : undefined;
  const res = await apiGet<Row[]>(
    `/api/v1/admin/sponsorships?limit=100${status ? `&status=${status}` : ''}`,
    { auth: true },
  );
  const link = (s?: string) => `/admin/sponsored${s ? `?status=${s}` : ''}`;
  return (
    <AdminShell me={me} active="sponsored" title="Sponsored posts">
      <p className="muted" style={{ maxWidth: '72ch' }}>
        Employers ask to promote a live post. Approve to show it, labelled &quot;Sponsored&quot;, to
        the people it fits. This is the <strong>demo plan</strong>: nobody is charged yet. Real
        payments need a payment provider, which the owner has to approve first.
      </p>
      <div className="chips">
        <Link className="chip" href={link()} aria-current={!status}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} className="chip" href={link(s)} aria-current={status === s}>
            {s[0]!.toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>
      {res.kind !== 'ok' ? (
        <p role="alert">Could not load sponsored posts. Reload in a moment.</p>
      ) : res.data.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Nothing here yet.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Post</th>
                <th>Requested by</th>
                <th>Days</th>
                <th>Status</th>
                <th>Ends</th>
                <th>Views</th>
                <th>Clicks</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/opportunities/${r.opportunity_id}`}>{r.title}</Link>
                    <br />
                    <span className="muted small">{r.company ?? ''}</span>
                  </td>
                  <td>{r.owner ?? 'Staff'}</td>
                  <td className="tabular">{r.days}</td>
                  <td>
                    <Badge tone={TONE[r.status]}>{r.status}</Badge>
                    {r.note ? <div className="muted small">{r.note}</div> : null}
                  </td>
                  <td className="tabular">{day(r.ends_at)}</td>
                  <td className="tabular">{r.impressions}</td>
                  <td className="tabular">{r.clicks}</td>
                  <td>{r.status === 'pending' ? <SponsoredActions id={r.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Start a demo sponsor</h2>
        <p className="muted">
          Promote any published opportunity at once (for example to show how sponsored posts look).
          Copy the opportunity ID from its page address.
        </p>
        <StartDemo />
      </section>
    </AdminShell>
  );
}
