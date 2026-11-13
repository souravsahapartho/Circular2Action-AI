import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { ErrorState } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, type LocationInfo } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { ProfileEditor, type ProfileData } from './profile-editor';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Profile({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/profile`);
  const [prof, locs] = await Promise.all([
    apiGet<ProfileData>('/api/v1/me/profile', { auth: true }),
    apiGet<LocationInfo[]>(`/api/v1/locations?locale=${locale}`),
  ]);
  return (
    <Page locale={locale} dict={d} section="profile" path="/app/profile" me={me}>
      <h1>{d.app.profileTitle}</h1>
      <p className="muted">{d.profile.privacyNote}</p>
      {prof.kind === 'ok' ? (
        <ProfileEditor
          initial={prof.data}
          locations={locs.kind === 'ok' ? locs.data : []}
          labels={d.profile}
          errors={d.errors}
          common={d.common}
          completenessLabel={d.app.completeness}
          levelLabels={d.eligibility as unknown as Record<string, string>}
        />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
