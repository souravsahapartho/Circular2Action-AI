import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { Breadcrumbs, EmptyState, ErrorState } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, idFromSlug, type OpportunityDetail } from '@/lib/api';
import { getMe } from '@/lib/session';
import { EligibilityCheck } from './eligibility-check';

export const metadata = { robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Eligibility for one opportunity. Signed-in visitors can use their saved profile (evaluated by the API with the
 * same engine); anyone can answer a few questions, which are evaluated in the browser and never sent or stored.
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
  const me = await getMe();
  const res = id
    ? await apiGet<OpportunityDetail>(`/api/v1/opportunities/${id}?locale=${locale}`)
    : ({ kind: 'not_found' } as const);
  return (
    <Page
      locale={locale}
      dict={d}
      section="explore"
      path={`/opportunities/${slug}/eligibility`}
      me={me}
    >
      {res.kind === 'ok' ? (
        <>
          <Breadcrumbs
            items={[
              { href: `/${locale}/opportunities`, label: d.nav.explore },
              { href: `/${locale}/opportunities/${slug}`, label: res.data.title },
              { label: d.eligibility.title },
            ]}
          />
          <h1>{d.eligibility.title}</h1>
          <p className="muted">
            <Link href={`/${locale}/opportunities/${slug}`}>{res.data.title}</Link> ·{' '}
            {res.data.organization}
          </p>
          <EligibilityCheck
            opportunityId={res.data.id}
            requirements={res.data.requirements ?? []}
            labels={d.eligibility}
            errors={d.errors}
            locale={locale}
            signedIn={me !== null}
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
