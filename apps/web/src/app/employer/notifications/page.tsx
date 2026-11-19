import { Alert } from '@/components/ui';
import { EmployerShell } from '@/components/employer-shell';
import { PushToggle } from '@/components/push-toggle';
import { apiGet } from '@/lib/api';
import { requireEmployer } from '@/lib/session';
import { EmployerNotifications, type EmployerNotification } from './notifications-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

export default async function EmployerNotificationsPage() {
  const me = await requireEmployer();
  const [prof, list] = await Promise.all([
    apiGet<{ company_name: string }>('/api/v1/employer/profile', { auth: true }),
    apiGet<EmployerNotification[]>('/api/v1/me/notifications?limit=50', { auth: true }),
  ]);
  return (
    <EmployerShell
      me={me}
      company={prof.kind === 'ok' ? prof.data.company_name : ''}
      active="notifications"
      title="Notifications"
    >
      <PushToggle locale="en" employer />
      {list.kind === 'ok' ? (
        <EmployerNotifications items={list.data} />
      ) : (
        <Alert kind="error">Could not load your notifications. Reload in a moment.</Alert>
      )}
    </EmployerShell>
  );
}
