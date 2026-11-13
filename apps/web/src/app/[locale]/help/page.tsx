import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export default async function Help({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const qa = [
    [d.static.helpQ1, d.static.helpA1],
    [d.static.helpQ2, d.static.helpA2],
    [d.static.helpQ3, d.static.helpA3],
  ] as const;
  return (
    <Page locale={locale} dict={d} section="other" path="/help">
      <div style={{ maxWidth: '70ch' }}>
        <h1>{d.static.helpTitle}</h1>
        {qa.map(([q, a]) => (
          <details key={q} className="card" style={{ marginBottom: 10 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{q}</summary>
            <p style={{ margin: '10px 0 0' }}>{a}</p>
          </details>
        ))}
      </div>
    </Page>
  );
}
