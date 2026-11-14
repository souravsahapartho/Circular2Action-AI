import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { ErrorState } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, type CategoryInfo, type LocationInfo } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { InterestsForm, type Prefs } from './interests-form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Interests({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/interests`);
  const [prefs, cats, locs] = await Promise.all([
    apiGet<Prefs & { activity_count: number }>('/api/v1/me/preferences', { auth: true }),
    apiGet<CategoryInfo[]>(`/api/v1/categories?locale=${locale}`),
    apiGet<LocationInfo[]>(`/api/v1/locations?locale=${locale}`),
  ]);
  return (
    <Page locale={locale} dict={d} section="interests" path="/app/interests" me={me}>
      <div className="narrow wide">
        <h1>{d.interests.title}</h1>
        <p className="muted">{d.interests.intro}</p>
        {prefs.kind === 'ok' ? (
          <InterestsForm
            initial={prefs.data}
            activityCount={prefs.data.activity_count}
            categories={cats.kind === 'ok' ? cats.data : []}
            locations={locs.kind === 'ok' ? locs.data : []}
            labels={d.interests}
            errors={d.errors}
          />
        ) : (
          <ErrorState dict={d} />
        )}
      </div>
    </Page>
  );
}
