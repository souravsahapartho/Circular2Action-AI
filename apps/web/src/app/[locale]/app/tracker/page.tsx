import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { EmptyState } from '@/components/states';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export const metadata = { robots: { index: false } };

export default async function Tracker({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  return (
    <Page locale={locale} dict={d} section="tracker" path="/app/tracker">
      <h1>{d.app.trackerTitle}</h1>
      <EmptyState title={d.app.signInRequired} text={d.home.tileTrackText} />
      <p>
        <Link className="btn" href={`/${locale}/sign-in`}>
          {d.nav.signIn}
        </Link>
      </p>
    </Page>
  );
}
