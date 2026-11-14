import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { EmptyState, ErrorState, Icon, Pagination } from '@/components/ui';
import { WebJobCard, type WebJob } from '@/components/web-job-card';
import { formatNumber, isLocale } from '@/i18n/config';
import { getDictionary, t } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { getMe } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Jobs from the web' };

const PAGE = 20;
const SOURCES = ['arbeitnow', 'remotive', 'google'];

export default async function WebJobs({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; source?: string; page?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const d = getDictionary(locale);
  const me = await getMe();
  const q = (sp.q ?? '').trim().slice(0, 120);
  const source = SOURCES.includes(sp.source ?? '') ? sp.source : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (q) qs.set('q', q);
  if (source) qs.set('source', source);
  const [res, sources] = await Promise.all([
    apiGet<WebJob[]>(`/api/v1/listings?${qs}`),
    apiGet<Array<{ id: string; label: string; homepage: string; listings: number }>>(
      '/api/v1/listings/sources',
    ),
  ]);
  const total = res.kind === 'ok' ? (res.total ?? res.data.length) : 0;
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { q: q || undefined, source, page: undefined, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    return `/${locale}/web-jobs${p.toString() ? `?${p}` : ''}`;
  };
  return (
    <Page locale={locale} dict={d} section="webjobs" path="/web-jobs" me={me}>
      <div className="page-head">
        <h1>{d.webJobs.title}</h1>
        <p className="muted lead">{d.webJobs.intro}</p>
        <p className="notice-strip">
          <Icon name="info" /> {d.webJobs.notice}
        </p>
      </div>
      <form className="search-bar" action={`/${locale}/web-jobs`}>
        <label htmlFor="wj-q" className="sr-only">
          {d.webJobs.search}
        </label>
        <input
          id="wj-q"
          name="q"
          className="input"
          placeholder={d.webJobs.searchPlaceholder}
          defaultValue={q}
        />
        <label htmlFor="wj-src" className="sr-only">
          {d.webJobs.sources}
        </label>
        <select id="wj-src" name="source" className="input" defaultValue={source ?? ''}>
          <option value="">{d.webJobs.allSources}</option>
          {(sources.kind === 'ok' ? sources.data : []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({formatNumber(s.listings, locale)})
            </option>
          ))}
        </select>
        <button className="btn" type="submit">
          <Icon name="search" /> {d.webJobs.search}
        </button>
      </form>
      {res.kind === 'ok' && res.data.length > 0 ? (
        <>
          <p className="muted small">
            {t(d.webJobs.showing, {
              n: formatNumber(res.data.length, locale),
              total: formatNumber(total, locale),
            })}
          </p>
          <div className="stack">
            {res.data.map((j) => (
              <WebJobCard key={j.id} job={j} locale={locale} d={d} tracked={me !== null} />
            ))}
          </div>
          <Pagination
            dict={d}
            label={`${page}`}
            prevHref={page > 1 ? link({ page: String(page - 1) }) : undefined}
            nextHref={page * PAGE < total ? link({ page: String(page + 1) }) : undefined}
          />
        </>
      ) : res.kind === 'ok' ? (
        <EmptyState
          icon="globe"
          title={d.webJobs.empty}
          text={d.webJobs.emptyText}
          action={
            <Link className="btn" href={`/${locale}/web-jobs`}>
              {d.webJobs.seeAll}
            </Link>
          }
        />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
