import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export default async function StaticPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  return (
    <Page locale={locale} dict={d} section="other" path="/about">
      <div style={{ maxWidth: '70ch' }}>
        <h1>{d.static.aboutTitle}</h1>
        <p>{d.static.aboutP1}</p>
        <p>{d.static.aboutP2}</p>
      </div>
    </Page>
  );
}
