import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { ResponsiveDetails } from '@/components/responsive-details';
import type { Reason } from '@/lib/reasons';
import { OpportunityList } from '@/components/opportunity-list';
import { SponsoredStrip } from '@/components/sponsored-strip';
import { EmptyState, ErrorState, Icon, Pagination } from '@/components/ui';
import { formatNumber, isLocale } from '@/i18n/config';
import { getDictionary, t } from '@/i18n/dictionaries';
import { apiGet, type CategoryInfo, type LocationInfo, type OpportunitySummary } from '@/lib/api';
import { getMe } from '@/lib/session';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 10;

export default async function Explore({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; location?: string; sort?: string; page?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const sp = await searchParams;
  const category = /^[a-z0-9-]{1,100}$/.test(sp.category ?? '') ? sp.category : undefined;
  const location = /^[a-z0-9-]{1,120}$/.test(sp.location ?? '') ? sp.location : undefined;
  const me0 = await getMe();
  // signed-in people get the list in "for you" order unless they pick another order
  const defaultSort = me0 ? 'recommended' : 'deadline';
  const sort =
    sp.sort === 'newest'
      ? 'newest'
      : sp.sort === 'deadline'
        ? 'deadline'
        : sp.sort === 'recommended' && me0
          ? 'recommended'
          : defaultSort;
  const page = Math.max(1, Math.min(500, Number.parseInt(sp.page ?? '1', 10) || 1));

  const me = me0;
  const recommended = sort === 'recommended';
  const qs = new URLSearchParams({
    locale,
    sort,
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  if (category) qs.set('category', category);
  if (location) qs.set('location', location);
  const [list, cats, locs, saved] = await Promise.all([
    recommended
      ? apiGet<Array<OpportunitySummary & { reasons: Reason[] }>>(`/api/v1/me/feed?${qs}`, {
          auth: true,
        })
      : apiGet<OpportunitySummary[]>(`/api/v1/opportunities?${qs}`),
    apiGet<CategoryInfo[]>(`/api/v1/categories?locale=${locale}`),
    apiGet<LocationInfo[]>(`/api/v1/locations?locale=${locale}`),
    me ? apiGet<string[]>('/api/v1/me/saved-ids', { auth: true }) : Promise.resolve(null),
  ]);
  const savedIds = me ? new Set(saved && saved.kind === 'ok' ? saved.data : []) : null;

  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      category,
      location,
      sort: sort === defaultSort ? undefined : sort,
      page: undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/${locale}/opportunities${s ? `?${s}` : ''}`;
  };
  const total = list.kind === 'ok' ? (list.total ?? list.data.length) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(category || location);
  const nf = (n: number) => formatNumber(n, locale);

  return (
    <Page
      locale={locale}
      dict={d}
      section="explore"
      path={`/opportunities${page > 1 || filtered ? `?${new URLSearchParams(Object.fromEntries(Object.entries({ category, location, sort: sort === defaultSort ? undefined : sort, page: page > 1 ? String(page) : undefined }).filter(([, v]) => v) as Array<[string, string]>))}` : ''}`}
      me={me}
    >
      <h1>{d.explore.title}</h1>
      <div className="explore">
        <aside>
          <ResponsiveDetails className="filters">
            <summary>
              <Icon name="sliders" /> {d.explore.filters}
            </summary>
            <div className="filters-body" style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: '0.9375rem' }}>{d.explore.categories}</h3>
              <ul className="cat-list">
                <li>
                  <Link href={href({ category: undefined })} aria-current={!category}>
                    <span>{d.explore.all}</span>
                    <span className="muted tabular">
                      {cats.kind === 'ok' ? nf(cats.data.reduce((n, c) => n + c.count, 0)) : ''}
                    </span>
                  </Link>
                </li>
                {cats.kind === 'ok'
                  ? cats.data.map((c) => (
                      <li key={c.slug}>
                        <Link href={href({ category: c.slug })} aria-current={c.slug === category}>
                          <span>{c.name}</span>
                          <span className="muted tabular">{nf(c.count)}</span>
                        </Link>
                      </li>
                    ))
                  : null}
              </ul>
              <form method="get" action={`/${locale}/opportunities`}>
                {category ? <input type="hidden" name="category" value={category} /> : null}
                <div className="field">
                  <label htmlFor="location">{d.explore.location}</label>
                  <select
                    id="location"
                    name="location"
                    className="input"
                    defaultValue={location ?? ''}
                  >
                    <option value="">{d.explore.allLocations}</option>
                    {locs.kind === 'ok'
                      ? locs.data.map((l) => (
                          <option key={l.id} value={l.slug}>
                            {l.name}
                          </option>
                        ))
                      : null}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sort">{d.explore.sort}</label>
                  <select id="sort" name="sort" className="input" defaultValue={sort}>
                    {me ? <option value="recommended">{d.explore.sortRecommended}</option> : null}
                    <option value="deadline">{d.explore.sortDeadline}</option>
                    <option value="newest">{d.explore.sortNewest}</option>
                  </select>
                </div>
                <div className="row-flex">
                  <button className="btn sm" type="submit">
                    {d.explore.applyFilters}
                  </button>
                  {filtered ? (
                    <Link className="btn ghost sm" href={`/${locale}/opportunities`}>
                      {d.explore.clearFilters}
                    </Link>
                  ) : null}
                </div>
              </form>
            </div>
          </ResponsiveDetails>
        </aside>

        <section aria-live="polite">
          {page === 1 && !filtered ? (
            <SponsoredStrip locale={locale} d={d} signedIn={Boolean(me)} />
          ) : null}
          {list.kind === 'ok' && list.data.length > 0 ? (
            <>
              <p className="muted tabular">{t(d.explore.count, { n: nf(total) })}</p>
              {recommended ? <p className="muted small">{d.explore.rankedNote}</p> : null}
              <OpportunityList
                items={list.data}
                locale={locale}
                dict={d}
                now={new Date()}
                savedIds={savedIds}
                nextPath={`/${locale}/opportunities`}
                {...(recommended
                  ? {
                      reasons: Object.fromEntries(
                        (list.data as Array<OpportunitySummary & { reasons?: Reason[] }>).map(
                          (o) => [o.id, o.reasons ?? []],
                        ),
                      ),
                      categoryNames: Object.fromEntries(
                        (cats.kind === 'ok' ? cats.data : []).map((c) => [c.slug, c.name]),
                      ),
                    }
                  : {})}
              />
              <Pagination
                prevHref={page > 1 ? href({ page: String(page - 1) }) : undefined}
                nextHref={page < pages ? href({ page: String(page + 1) }) : undefined}
                label={`${t(d.explore.page, { n: nf(page) })} / ${nf(pages)}`}
                dict={d}
              />
            </>
          ) : list.kind === 'unavailable' ? (
            <ErrorState dict={d} />
          ) : filtered ? (
            <EmptyState icon="search" title={d.explore.noMatchTitle} text={d.explore.noMatchText} />
          ) : (
            <EmptyState title={d.explore.emptyTitle} text={d.explore.emptyText} />
          )}
        </section>
      </div>
    </Page>
  );
}
