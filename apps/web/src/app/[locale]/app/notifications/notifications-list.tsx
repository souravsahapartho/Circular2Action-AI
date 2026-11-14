'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import { t } from '@/i18n/dictionaries';
import { formatDate, type Locale } from '@/i18n/config';
import { callApi } from '@/lib/client-api';
import { titleFor } from '@/lib/titles';

export interface NotificationRow {
  id: string;
  type: string;
  subject_type: string | null;
  subject_id: string | null;
  params: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

export function NotificationsList({
  items,
  locale,
  labels,
  statuses,
}: {
  items: NotificationRow[];
  locale: Locale;
  labels: Dictionary['notifications'];
  statuses: Record<string, string>;
  errors: Record<string, string>;
}) {
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

  const text = (n: NotificationRow): string => {
    const p = n.params as {
      title?: string;
      title_alt?: string | null;
      code?: string;
      tracking_code?: string;
      status?: string;
    };
    const title = titleFor(String(p.title ?? ''), p.title_alt ?? null, locale);
    if (n.type === 'application_update') {
      return t(labels.application_update, {
        code: String(p.tracking_code ?? ''),
        status: statuses[String(p.status)] ?? String(p.status ?? ''),
      });
    }
    const tpl = (labels as Record<string, string>)[n.type];
    return tpl ? t(tpl, { title }) : title;
  };
  const href = (n: NotificationRow): string | null => {
    if (n.subject_type === 'opportunity' && n.subject_id)
      return `/${locale}/opportunities/x-${n.subject_id}`;
    if (n.subject_type === 'application' && n.subject_id)
      return `/${locale}/app/applications/${n.subject_id}`;
    return null;
  };

  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {unread > 0 ? (
        <div>
          <button type="button" className="btn secondary sm" onClick={() => void markAll()}>
            {labels.markAll}
          </button>
        </div>
      ) : null}
      <ul className="notif-list">
        {rows.map((n) => {
          const p = n.params as { slot?: string; note?: string | null };
          const link = href(n);
          return (
            <li key={n.id} className={n.read ? 'notif' : 'notif unread'}>
              <span className={`notif-dot type-${n.type}`} aria-hidden="true" />
              <div>
                <p className="notif-title">{text(n)}</p>
                {n.type === 'deadline_reminder' && p.slot ? (
                  <p className="muted small" style={{ margin: 0 }}>
                    {(labels as Record<string, string>)[`slot_${p.slot}`]}
                  </p>
                ) : null}
                {n.type === 'application_update' && p.note ? (
                  <p className="muted small" style={{ margin: 0 }}>
                    {p.note}
                  </p>
                ) : null}
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  {formatDate(n.created_at, locale)}
                </p>
              </div>
              <div className="notif-actions">
                {link ? (
                  <Link className="btn secondary sm" href={link} onClick={() => void markOne(n.id)}>
                    {labels.open}
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
