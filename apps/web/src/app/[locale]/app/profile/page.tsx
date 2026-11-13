import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { EmptyState } from '@/components/states';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export const metadata = { robots: { index: false } };

export default async function Profile({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  return (
    <Page locale={locale} dict={d} section="profile" path="/app/profile">
      <h1>{d.app.profileTitle}</h1>
      <EmptyState title={d.app.signInRequired} text={d.eligibility.signInNeeded} />
      <p>
        <Link className="btn" href={`/${locale}/sign-in`}>
          {d.nav.signIn}
        </Link>
      </p>
    </Page>
  );
}
