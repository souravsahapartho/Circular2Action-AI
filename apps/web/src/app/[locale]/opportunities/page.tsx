import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { EmptyState, ErrorState, OpportunityRows } from '@/components/states';
import { formatNumber, isLocale } from '@/i18n/config';
import { getDictionary, t } from '@/i18n/dictionaries';
import { apiGet, type OpportunitySummary } from '@/lib/api';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['jobs', 'internships', 'scholarships'] as const;

export default async function Explore({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const requested = (await searchParams).category;
  const category = CATEGORIES.find((c) => c === requested);
  const res = await apiGet<OpportunitySummary[]>(
    `/api/v1/opportunities?locale=${locale}${category ? `&category=${category}` : ''}`,
  );
  const tab = (slug: string | undefined, label: string) => {
    const active = slug === category;
    return (
      <li key={slug ?? 'all'}>
        <Link
          href={slug ? `/${locale}/opportunities?category=${slug}` : `/${locale}/opportunities`}
          aria-current={active ? 'page' : undefined}
          className={`btn${active ? '' : ' secondary'}`}
        >
          {label}
        </Link>
      </li>
    );
  };
  return (
    <Page locale={locale} dict={d} section="explore" path="/opportunities">
      <h1>{d.explore.title}</h1>
      <nav aria-label={d.explore.categories}>
        <ul
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            listStyle: 'none',
            padding: 0,
            margin: '0 0 16px',
          }}
        >
          {tab(undefined, d.explore.all)}
          {CATEGORIES.map((c) => tab(c, d.explore[c]))}
        </ul>
      </nav>
      {res.kind === 'ok' && res.data.length > 0 ? (
        <>
          <p className="muted tabular">
            {t(d.explore.count, { n: formatNumber(res.total ?? res.data.length, locale) })}
          </p>
          <OpportunityRows items={res.data} locale={locale} dict={d} now={new Date()} />
        </>
      ) : res.kind === 'unavailable' ? (
        <ErrorState dict={d} />
      ) : (
        <EmptyState title={d.explore.emptyTitle} text={d.explore.emptyText} />
      )}
    </Page>
  );
}
