'use client';

import { useState } from 'react';
import { Alert, Badge } from '@/components/ui';
import { callApi } from '@/lib/client-api';

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  roles: string[];
}

const STAFF_ROLES = [
  'editor',
  'verifier',
  'moderator',
  'source_manager',
  'analyst',
  'admin',
  'super_admin',
];

export function RoleEditor({
  users,
  canManage,
  canModerate = false,
  meId,
}: {
  users: UserRow[];
  canManage: boolean;
  canModerate?: boolean;
  meId: string;
}) {
  const [rows, setRows] = useState(users);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function setStatus(u: UserRow, status: 'active' | 'suspended') {
    if (
      status === 'suspended' &&
      !window.confirm(
        `Suspend ${u.email}? They are signed out everywhere and cannot sign in until restored.`,
      )
    ) {
      return;
    }
    setMsg(null);
    const out = await callApi('POST', `/api/v1/admin/users/${u.id}/status`, { status });
    if (out.ok) {
      setRows((p) => p.map((r) => (r.id === u.id ? { ...r, status } : r)));
      setMsg({
        ok: true,
        text: status === 'suspended' ? `${u.email} is suspended.` : `${u.email} is active again.`,
      });
    } else setMsg({ ok: false, text: out.error?.message ?? 'Could not change the account.' });
  }

  async function save(u: UserRow) {
    setMsg(null);
    const out = await callApi('PUT', `/api/v1/admin/users/${u.id}/roles`, { roles: draft });
    if (out.ok) {
      setRows((p) => p.map((r) => (r.id === u.id ? { ...r, roles: ['user', ...draft] } : r)));
      setEditing(null);
      setMsg({ ok: true, text: `Roles updated for ${u.email}. Their sessions were signed out.` });
    } else setMsg({ ok: false, text: out.error?.message ?? 'Could not update roles.' });
  }

  return (
    <>
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Roles</th>
              <th>Joined</th>
              <th>Last sign-in</th>
              {canManage || canModerate ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.display_name}</strong>
                  <div className="muted small">{u.email}</div>
                </td>
                <td>
                  <Badge tone={u.status === 'active' ? 'success' : 'warn'}>{u.status}</Badge>
                </td>
                <td>
                  {editing === u.id ? (
                    <div className="stack">
                      {STAFF_ROLES.map((r) => (
                        <label key={r} className="check">
                          <input
                            type="checkbox"
                            checked={draft.includes(r)}
                            onChange={(e) =>
                              setDraft((p) =>
                                e.target.checked ? [...p, r] : p.filter((x) => x !== r),
                              )
                            }
                          />
                          <span>{r}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    u.roles
                      .filter((r) => r !== 'user')
                      .map((r) => (
                        <Badge key={r} tone="info">
                          {r}
                        </Badge>
                      ))
                  )}
                </td>
                <td className="tabular">{u.created_at.slice(0, 10)}</td>
                <td className="tabular">{u.last_login_at ? u.last_login_at.slice(0, 10) : '–'}</td>
                {canManage || canModerate ? (
                  <td>
                    {editing === u.id ? (
                      <div className="row-flex">
                        <button className="btn sm" type="button" onClick={() => void save(u)}>
                          Save
                        </button>
                        <button
                          className="btn ghost sm"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        {canManage ? (
                          <button
                            className="btn secondary sm"
                            type="button"
                            onClick={() => {
                              setEditing(u.id);
                              setDraft(u.roles.filter((r) => r !== 'user'));
                            }}
                            title={
                              u.id === meId
                                ? 'You cannot remove your own super admin role'
                                : undefined
                            }
                          >
                            Edit roles
                          </button>
                        ) : null}
                        {canModerate && u.id !== meId && u.status !== 'pending_deletion' ? (
                          <button
                            className={`btn sm ${u.status === 'suspended' ? '' : 'danger'}`}
                            type="button"
                            style={{ marginLeft: 6 }}
                            onClick={() =>
                              void setStatus(u, u.status === 'suspended' ? 'active' : 'suspended')
                            }
                          >
                            {u.status === 'suspended' ? 'Restore' : 'Suspend'}
                          </button>
                        ) : null}
                      </>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
