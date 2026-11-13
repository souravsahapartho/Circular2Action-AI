import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { Alert } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export default async function StaticPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  return (
    <Page locale={locale} dict={d} section="other" path="/terms">
      <div style={{ maxWidth: '70ch' }}>
        <h1>{d.static.termsTitle}</h1>
        <Alert kind="warn" role="note">
          {d.static.draftNotice}
        </Alert>
        <p>{d.static.termsP1}</p>
        <p>{d.static.termsP2}</p>
      </div>
    </Page>
  );
}
