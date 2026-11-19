'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from '@/lib/client-api';

export interface EmployerNotification {
  id: string;
  type: string;
  subject_type: string | null;
  subject_id: string | null;
  params: { title?: string; message?: string };
  read: boolean;
  created_at: string;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));

function heading(n: EmployerNotification): string {
  if (n.type === 'new_application') return `New application: ${n.params.title ?? 'your post'}`;
  return n.params.title ?? 'Notification';
}

/** The employer's notifications: new applications and messages from staff. */
export function EmployerNotifications({ items }: { items: EmployerNotification[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const unread = rows.filter((r) => !r.read).length;

  async function markAll() {
    const out = await callApi('POST', '/api/v1/me/notifications/read', { all: true });
    if (out.ok) {
      setRows((r) => r.map((x) => ({ ...x, read: true })));
      router.refresh();
    }
  }
  async function markOne(id: string) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, read: true } : x)));
    await callApi('POST', '/api/v1/me/notifications/read', { ids: [id] });
  }

  if (rows.length === 0) {
    return (
      <div className="panel">
        <p className="muted" style={{ margin: 0 }}>
          Nothing yet. New applications to your posts and messages from the team appear here.
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      {unread > 0 ? (
        <div>
          <button type="button" className="btn secondary sm" onClick={() => void markAll()}>
            Mark all as read
          </button>
        </div>
      ) : null}
      <ul className="notif-list">
        {rows.map((n) => (
          <li key={n.id} className={`notif${n.read ? '' : ' unread'}`}>
            <span className={`notif-dot type-${n.type}`} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{heading(n)}</strong>
              {n.params.message ? <p className="muted small">{n.params.message}</p> : null}
              <p className="muted small" style={{ margin: 0 }}>
                {when(n.created_at)}
                {n.subject_type === 'application' && n.subject_id ? (
                  <>
                    {' · '}
                    <Link
                      href={`/employer/applications/${n.subject_id}`}
                      onClick={() => void markOne(n.id)}
                    >
                      Open
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
            {!n.read ? <span className="badge info">New</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
