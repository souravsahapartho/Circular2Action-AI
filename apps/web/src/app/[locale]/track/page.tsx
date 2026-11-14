import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getMe } from '@/lib/session';
import { TrackForm } from './track-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Track an application' };

export default async function Track({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await getMe();
  return (
    <Page locale={locale} dict={d} section="track" path="/track" me={me}>
      <div className="narrow">
        <h1>{d.track.title}</h1>
        <p className="muted">{d.track.intro}</p>
        <TrackForm locale={locale} labels={d.track} />
        <p className="muted small" style={{ marginTop: 16 }}>
          {d.track.privacy}
        </p>
      </div>
    </Page>
  );
}
