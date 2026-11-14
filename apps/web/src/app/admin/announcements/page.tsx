import { AdminShell } from '@/components/admin-shell';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';
import { redirect } from 'next/navigation';
import { hasPermission, type Role } from '@c2a/contracts';
import { AnnouncementForm } from './announcement-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Announcements' };

export default async function Announcements() {
  const me = await requireStaff();
  if (!hasPermission(me.roles as Role[], 'system.operate')) redirect('/admin');
  const cats = await apiGet<Array<{ slug: string; name: string }>>('/api/v1/categories?locale=en');
  return (
    <AdminShell me={me} active="announcements" title="Announcements">
      <div className="panel-grid two-equal">
        <section className="panel">
          <h2>Send an announcement</h2>
          <p className="muted">
            It appears in each person&apos;s notifications (the bell). Send it to everyone, or only
            to people interested in one kind of opportunity: they chose it, or looked at it in the
            last 90 days.
          </p>
          <AnnouncementForm categories={cats.kind === 'ok' ? cats.data : []} />
        </section>
        <section className="panel">
          <h2>Good to know</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              Each announcement is recorded in the audit log with the audience and the number of
              people told.
            </li>
            <li>
              People cannot reply; keep it short and useful (a deadline, a change, a new batch).
            </li>
            <li>There is no email yet, so only people who open the site will see it.</li>
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}
