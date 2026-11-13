import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { EmptyState, ErrorState, OpportunityRows } from '@/components/states';
import { formatNumber, isLocale } from '@/i18n/config';
import { getDictionary, t } from '@/i18n/dictionaries';
import { apiGet, type OpportunitySummary } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Explore({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const res = await apiGet<OpportunitySummary[]>(`/api/v1/opportunities?locale=${locale}`);
  return (
    <Page locale={locale} dict={d} section="explore" path="/opportunities">
      <h1>{d.explore.title}</h1>
      {res.kind === 'ok' && res.data.length > 0 ? (
        <>
          <p className="muted tabular">
            {t(d.explore.count, { n: formatNumber(res.data.length, locale) })}
          </p>
          <OpportunityRows items={res.data} locale={locale} dict={d} now={new Date()} />
        </>
      ) : res.kind === 'unavailable' && (res.status === undefined || res.status >= 500) ? (
        <ErrorState dict={d} />
      ) : (
        <EmptyState title={d.explore.emptyTitle} text={d.explore.emptyText} />
      )}
    </Page>
  );
}
