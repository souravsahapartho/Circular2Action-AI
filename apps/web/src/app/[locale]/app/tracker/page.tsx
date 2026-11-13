import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { ErrorState } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { TrackerView, type AppRow } from './tracker-view';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Tracker({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/tracker`);
  const res = await apiGet<AppRow[]>('/api/v1/me/applications', { auth: true });
  return (
    <Page locale={locale} dict={d} section="tracker" path="/app/tracker" me={me}>
      <h1>{d.app.trackerTitle}</h1>
      {res.kind === 'ok' ? (
        <TrackerView
          initial={res.data}
          locale={locale}
          labels={d.tracker}
          errors={d.errors}
          explore={d.explore}
          common={d.common}
        />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
