import { AdminShell } from '@/components/admin-shell';
import { Alert, Badge } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';
import { OrganizationForm } from './organization-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Organisations' };

interface Org {
  id: string;
  slug: string;
  name_en: string | null;
  name_bn: string | null;
  type: string;
  verification_status: string;
}

export default async function Organizations({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await requireStaff();
  const q = ((await searchParams).q ?? '').trim().slice(0, 200);
  const res = await apiGet<Org[]>(
    `/api/v1/admin/organizations${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    { auth: true },
  );
  return (
    <AdminShell me={me} active="organizations" title="Organisations">
      <OrganizationForm />
      <form className="row-flex" style={{ margin: '24px 0 12px' }}>
        <label htmlFor="q" className="sr-only">
          Search organisations
        </label>
        <input
          id="q"
          name="q"
          className="input"
          style={{ maxWidth: 320 }}
          defaultValue={q}
          placeholder="Search organisations"
        />
        <button className="btn secondary" type="submit">
          Search
        </button>
      </form>
      {res.kind !== 'ok' ? (
        <Alert kind="error">Could not load organisations. Reload in a moment.</Alert>
      ) : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>English name</th>
              <th>Bangla name</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {res.kind === 'ok' && res.data.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No organisations yet.
                </td>
              </tr>
            ) : null}
            {res.kind === 'ok'
              ? res.data.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name_en ?? '–'}</td>
                    <td lang="bn">{o.name_bn ?? '–'}</td>
                    <td>{o.type}</td>
                    <td>
                      <Badge tone={o.verification_status === 'verified' ? 'success' : 'neutral'}>
                        {o.verification_status}
                      </Badge>
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
