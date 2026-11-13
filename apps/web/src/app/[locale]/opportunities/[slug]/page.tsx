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
          {res.data.title.startsWith('[') ? (
            <p className="state" role="note" style={{ padding: 12 }}>
              {d.detail.sampleNotice}
            </p>
          ) : null}
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
            {res.data.vacancies ? (
              <>
                <dt>{d.detail.vacancies}</dt>
                <dd className="tabular">{res.data.vacancies}</dd>
              </>
            ) : null}
          </dl>
          {res.data.summary ? <p style={{ maxWidth: '70ch' }}>{res.data.summary}</p> : null}
          <h2>{d.detail.requirements}</h2>
          {res.data.requirements && res.data.requirements.length > 0 ? (
            <ul className="rows">
              {res.data.requirements.map((r) => (
                <li key={r.id} className="row" style={{ gridTemplateColumns: '1fr 140px' }}>
                  <span>{r.text ?? r.rule_type}</span>
                  <span className="muted">
                    {r.necessity === 'mandatory' ? d.detail.mandatory : d.detail.preferred}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{d.detail.noRequirements}</p>
          )}
          <p style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 24 }}>
            <Link className="btn" href={`/${locale}/opportunities/${slug}/eligibility`}>
              {d.detail.checkEligibility}
            </Link>
            {res.data.source_url ? (
              <a className="btn secondary" href={res.data.source_url} rel="noopener nofollow">
                {d.detail.official}
              </a>
            ) : null}
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
