import { redirect } from 'next/navigation';
import { hasPermission, type Role } from '@c2a/contracts';
import { AdminShell } from '@/components/admin-shell';
import { Badge } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';
import { AnnouncementForm } from './announcement-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

interface Sent {
  id: string;
  at: string;
  audience: string;
  category: string | null;
  title: string;
  message: string;
  told: number;
}

const AUDIENCE: Record<string, string> = {
  all: 'Everyone',
  seekers: 'Job seekers',
  employers: 'Employers',
  category: 'Interested in a kind',
  user: 'One person',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));

export default async function Notifications() {
  const me = await requireStaff();
  if (!hasPermission(me.roles as Role[], 'system.operate')) redirect('/admin');
  const [cats, history] = await Promise.all([
    apiGet<Array<{ slug: string; name: string }>>('/api/v1/categories?locale=en'),
    apiGet<Sent[]>('/api/v1/admin/notifications/history', { auth: true }),
  ]);
  return (
    <AdminShell me={me} active="announcements" title="Notifications">
      <div className="panel-grid two-equal">
        <section className="panel">
          <h2>Send a notification</h2>
          <p className="muted">
            It appears in the bell inside the app, and as a push on phones and browsers that turned
            push on. Employers and job seekers get separate messages, or write to one person.
          </p>
          <AnnouncementForm categories={cats.kind === 'ok' ? cats.data : []} />
        </section>
        <section className="panel">
          <h2>Sent recently</h2>
          {history.kind === 'ok' && history.data.length > 0 ? (
            <ul className="sent-list">
              {history.data.map((h) => (
                <li key={h.id}>
                  <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                    <strong>{h.title}</strong>
                    <Badge tone="info">{AUDIENCE[h.audience] ?? h.audience}</Badge>
                  </div>
                  {h.message ? <p className="muted small">{h.message}</p> : null}
                  <p className="muted small" style={{ margin: 0 }}>
                    {when(h.at)} · {h.told} {h.told === 1 ? 'person' : 'people'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing sent yet.</p>
          )}
          <h3 style={{ marginTop: 20 }}>Good to know</h3>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Every message is recorded in the audit log with its audience and reach.</li>
            <li>People cannot reply; keep it short and useful.</li>
            <li>There is no email yet, so people see it in the app or by push.</li>
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}
