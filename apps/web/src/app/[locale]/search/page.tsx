import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { OpportunityList } from '@/components/opportunity-list';
import { EmptyState, ErrorState, Icon } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary, t } from '@/i18n/dictionaries';
import { apiGet, type OpportunitySummary } from '@/lib/api';
import { getMe } from '@/lib/session';

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
  const me = await getMe();
  const [res, saved] = await Promise.all([
    q
      ? apiGet<OpportunitySummary[]>(
          `/api/v1/search?q=${encodeURIComponent(q)}&locale=${locale}&limit=30`,
        )
      : Promise.resolve(null),
    me ? apiGet<string[]>('/api/v1/me/saved-ids', { auth: true }) : Promise.resolve(null),
  ]);
  const savedIds = me ? new Set(saved && saved.kind === 'ok' ? saved.data : []) : null;
  return (
    <Page
      locale={locale}
      dict={d}
      section="search"
      path={q ? `/search?q=${encodeURIComponent(q)}` : '/search'}
      me={me}
    >
      <h1>{d.search.title}</h1>
      <form role="search" className="searchbar" style={{ marginBottom: 24, maxWidth: 680 }}>
        <label htmlFor="q" className="sr-only">
          {d.home.searchLabel}
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          className="input"
          placeholder={d.home.searchPlaceholder}
          autoComplete="off"
        />
        <button className="btn" type="submit">
          <Icon name="search" /> {d.home.searchButton}
        </button>
      </form>
      {!q ? (
        <p className="muted">{d.search.noQuery}</p>
      ) : (
        <section aria-live="polite">
          <h2 style={{ marginTop: 0 }}>{t(d.search.resultsFor, { q })}</h2>
          {res?.kind === 'ok' && res.data.length > 0 ? (
            <OpportunityList
              items={res.data}
              locale={locale}
              dict={d}
              now={new Date()}
              savedIds={savedIds}
              nextPath={`/${locale}/search?q=${encodeURIComponent(q)}`}
            />
          ) : res?.kind === 'unavailable' ? (
            <ErrorState dict={d} />
          ) : (
            <EmptyState icon="search" title={d.search.emptyTitle} text={d.search.emptyText} />
          )}
        </section>
      )}
    </Page>
  );
}
