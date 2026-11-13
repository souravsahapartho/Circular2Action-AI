import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { EmptyState, OpportunityRows } from '@/components/states';
import { isLocale } from '@/i18n/config';
import { getDictionary, t } from '@/i18n/dictionaries';
import { apiGet, type OpportunitySummary } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Search({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const q = ((await searchParams).q ?? '').trim().slice(0, 200);
  const res = q
    ? await apiGet<OpportunitySummary[]>(
        `/api/v1/search?q=${encodeURIComponent(q)}&locale=${locale}`,
      )
    : null;
  return (
    <Page
      locale={locale}
      dict={d}
      section="search"
      path={q ? `/search?q=${encodeURIComponent(q)}` : '/search'}
    >
      <h1>{d.search.title}</h1>
      <form role="search" className="searchbar" style={{ marginBottom: 24 }}>
        <label htmlFor="q" className="sr-only">
          {d.home.searchLabel}
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          className="input"
          placeholder={d.home.searchPlaceholder}
        />
        <button className="btn" type="submit">
          {d.home.searchButton}
        </button>
      </form>
      {!q ? (
        <p className="muted">{d.search.noQuery}</p>
      ) : (
        <>
          <h2>{t(d.search.resultsFor, { q })}</h2>
          {res?.kind === 'ok' && res.data.length > 0 ? (
            <OpportunityRows items={res.data} locale={locale} dict={d} now={new Date()} />
          ) : (
            <EmptyState title={d.search.emptyTitle} text={d.search.emptyText} />
          )}
        </>
      )}
    </Page>
  );
}
