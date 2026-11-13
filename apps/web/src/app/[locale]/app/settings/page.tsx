import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { SettingsPanel, type SessionInfo } from './settings-panel';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Settings({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/settings`);
  const pending = me.status === 'pending_deletion';
  const [consents, sessions, deletion] = await Promise.all([
    pending
      ? Promise.resolve(null)
      : apiGet<{ state: Record<string, boolean> }>('/api/v1/me/consents', { auth: true }),
    pending
      ? Promise.resolve(null)
      : apiGet<SessionInfo[]>('/api/v1/auth/sessions', { auth: true }),
    pending
      ? apiGet<{ grace_ends_at: string }>('/api/v1/me/delete', { auth: true })
      : Promise.resolve(null),
  ]);
  return (
    <Page locale={locale} dict={d} section="settings" path="/app/settings" me={me}>
      <h1>{d.app.settingsTitle}</h1>
      <SettingsPanel
        locale={locale}
        me={{ name: me.display_name, email: me.email, locale: me.locale, pendingDeletion: pending }}
        consents={consents && consents.kind === 'ok' ? consents.data.state : null}
        sessions={sessions && sessions.kind === 'ok' ? sessions.data : []}
        graceEndsAt={deletion && deletion.kind === 'ok' ? deletion.data.grace_ends_at : null}
        labels={d.settings}
        errors={d.errors}
        auth={d.auth}
      />
    </Page>
  );
}
