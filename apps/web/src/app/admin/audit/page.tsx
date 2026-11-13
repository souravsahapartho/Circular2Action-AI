import { AdminShell } from '@/components/admin-shell';
import { Alert } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit log' };

interface Entry {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  at: string;
}

export default async function Audit() {
  const me = await requireStaff();
  const res = await apiGet<Entry[]>('/api/v1/admin/audit-logs?limit=100', { auth: true });
  return (
    <AdminShell me={me} active="audit" title="Audit log">
      <p className="muted">
        Every staff action is recorded here. Entries cannot be edited or deleted.
      </p>
      {res.kind !== 'ok' ? <Alert kind="error">Could not load the audit log.</Alert> : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {res.kind === 'ok' && res.data.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No entries yet.
                </td>
              </tr>
            ) : null}
            {res.kind === 'ok'
              ? res.data.map((e) => (
                  <tr key={e.id}>
                    <td className="tabular">{e.at.replace('T', ' ').slice(0, 19)}</td>
                    <td>
                      {e.actor_role ?? 'system'}
                      <div className="muted small mono">{e.actor_id}</div>
                    </td>
                    <td className="mono">{e.action}</td>
                    <td className="mono small">
                      {e.target_type ?? ''} {e.target_id ?? ''}
                    </td>
                    <td>{e.reason ?? ''}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
