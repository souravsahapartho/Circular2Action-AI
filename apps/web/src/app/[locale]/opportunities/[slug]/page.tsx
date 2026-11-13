import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { DeadlineChip, EmptyState, ErrorState } from '@/components/states';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, idFromSlug, type OpportunityDetail } from '@/lib/api';

export const dynamic = 'force-dynamic';


export default async function Detail({
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
    <Page locale={locale} dict={d} section="explore" path={`/opportunities/${slug}`}>
      {res.kind === 'ok' ? (
        <article>
          <h1>{res.data.title}</h1>
          <p className="muted">{res.data.organization}</p>
          {res.data.verified ? <p>✓ {d.detail.verified}</p> : null}
          <h2>{d.detail.facts}</h2>
          <dl>
            {res.data.deadline_at ? (
              <>
                <dt>{d.explore.deadline}</dt>
                <dd>
                  <DeadlineChip
                    iso={res.data.deadline_at}
                    locale={locale}
                    dict={d}
                    now={new Date()}
                  />
                </dd>
              </>
            ) : null}
            {res.data.location ? (
              <>
                <dt>{d.explore.location}</dt>
                <dd>{res.data.location}</dd>
              </>
            ) : null}
          </dl>
          {res.data.summary ? <p style={{ maxWidth: '70ch' }}>{res.data.summary}</p> : null}
          <p style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link className="btn" href={`/${locale}/opportunities/${slug}/eligibility`}>
              {d.detail.checkEligibility}
            </Link>
            {res.data.source_url ? (
              <a className="btn secondary" href={res.data.source_url} rel="noopener nofollow">
                {d.detail.official}
              </a>
            ) : null}
          </p>
          <p>
            <a href="#report">{d.detail.report}</a>
          </p>
        </article>
      ) : res.kind === 'not_found' ? (
        <EmptyState title={d.detail.notFound} text={d.explore.emptyText} />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
