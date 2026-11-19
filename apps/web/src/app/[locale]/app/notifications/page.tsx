import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { PushToggle } from '@/components/push-toggle';
import { EmptyState, ErrorState } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { NotificationsList, type NotificationRow } from './notifications-list';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Notifications({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/notifications`);
  const res = await apiGet<NotificationRow[]>('/api/v1/me/notifications?limit=50', { auth: true });
  return (
    <Page locale={locale} dict={d} section="notifications" path="/app/notifications" me={me}>
      <div className="narrow wide">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0 }}>{d.notifications.title}</h1>
          <Link className="btn secondary" href={`/${locale}/app/interests`}>
            {d.notifications.settings}
          </Link>
        </div>
        <PushToggle locale={locale} />
        {res.kind === 'ok' && res.data.length > 0 ? (
          <NotificationsList
            items={res.data}
            locale={locale}
            labels={d.notifications}
            statuses={d.statuses as Record<string, string>}
            errors={d.errors}
          />
        ) : res.kind === 'ok' ? (
          <EmptyState icon="info" title={d.notifications.empty} text={d.notifications.emptyText} />
        ) : (
          <ErrorState dict={d} />
        )}
      </div>
    </Page>
  );
}
