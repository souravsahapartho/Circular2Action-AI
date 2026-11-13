import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { EmptyState, ErrorState } from '@/components/states';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, idFromSlug, type OpportunityDetail } from '@/lib/api';
import { EligibilityCheck } from './eligibility-check';

export const metadata = { robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Eligibility for one opportunity. The rules come from the API; the answers are evaluated in the visitor's
 * browser with the same engine the API tests use, so nothing personal is sent or stored (plan principles PR-1..).
 */
export default async function Eligibility({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const id = idFromSlug(slug);
  const res = id
    ? await apiGet<OpportunityDetail>(`/api/v1/opportunities/${id}?locale=${locale}`)
    : ({ kind: 'not_found' } as const);
  return (
    <Page locale={locale} dict={d} section="explore" path={`/opportunities/${slug}/eligibility`}>
      <h1>{d.eligibility.title}</h1>
      {res.kind === 'ok' ? (
        <>
          <p className="muted">{res.data.title}</p>
          <EligibilityCheck
            requirements={res.data.requirements ?? []}
            labels={d.eligibility}
            locale={locale}
          />
        </>
      ) : res.kind === 'not_found' ? (
        <EmptyState title={d.detail.notFound} text={d.explore.emptyText} />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
