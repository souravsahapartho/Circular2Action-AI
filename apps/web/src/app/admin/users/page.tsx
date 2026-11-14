import { hasPermission, type Role } from '@c2a/contracts';
import { AdminShell } from '@/components/admin-shell';
import { Alert } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';
import { RoleEditor, type UserRow } from './role-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users' };

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireStaff();
  const q = ((await searchParams).q ?? '').trim().slice(0, 200);
  const res = await apiGet<UserRow[]>(
    `/api/v1/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    { auth: true },
  );
  const canManage = me.roles.includes('super_admin');
  return (
    <AdminShell me={me} active="users" title="Users">
      <form className="row-flex" style={{ marginBottom: 16 }}>
        <label htmlFor="q" className="sr-only">
          Search users
        </label>
        <input
          id="q"
          name="q"
          className="input"
          style={{ maxWidth: 320 }}
          defaultValue={q}
          placeholder="Email or name"
        />
        <button className="btn secondary" type="submit">
          Search
        </button>
      </form>
      {!canManage ? <Alert kind="info">Only a super admin can change roles.</Alert> : null}
      {res.kind !== 'ok' ? (
        <Alert kind="error">Could not load users. Reload in a moment.</Alert>
      ) : (
        <RoleEditor
          users={res.data}
          canManage={canManage}
          canModerate={hasPermission(me.roles as Role[], 'user.moderate')}
          meId={me.id}
        />
      )}
    </AdminShell>
  );
}
