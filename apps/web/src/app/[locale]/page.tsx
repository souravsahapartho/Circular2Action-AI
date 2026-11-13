import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { OpportunityList } from '@/components/opportunity-list';
import { Icon } from '@/components/ui';
import { formatNumber, isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, type CategoryInfo, type OpportunitySummary } from '@/lib/api';
import { getMe } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await getMe();
  const [cats, soon, newest, saved] = await Promise.all([
    apiGet<CategoryInfo[]>(`/api/v1/categories?locale=${locale}`),
    apiGet<OpportunitySummary[]>(`/api/v1/opportunities?locale=${locale}&limit=4`),
    apiGet<OpportunitySummary[]>(`/api/v1/opportunities?locale=${locale}&limit=4&sort=newest`),
    me ? apiGet<string[]>('/api/v1/me/saved-ids', { auth: true }) : Promise.resolve(null),
  ]);
  const savedIds = me ? new Set(saved && saved.kind === 'ok' ? saved.data : []) : null;
  const total = cats.kind === 'ok' ? cats.data.reduce((n, c) => n + c.count, 0) : null;
  const now = new Date();
  const tiles = [
    { slug: 'jobs', icon: 'briefcase' as const, title: d.home.tileJobs, text: d.home.tileJobsText },
    {
      slug: 'internships',
      icon: 'users' as const,
      title: d.home.tileInternships,
      text: d.home.tileInternshipsText,
    },
    {
      slug: 'scholarships',
      icon: 'graduation' as const,
      title: d.home.tileScholarships,
      text: d.home.tileScholarshipsText,
    },
  ];
  const countFor = (slug: string) =>
    cats.kind === 'ok'
      ? formatNumber(cats.data.find((c) => c.slug === slug)?.count ?? 0, locale)
      : '–';

  return (
    <Page locale={locale} dict={d} section="home" path="" me={me} bare>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <h1>{d.home.title}</h1>
            <p className="lead">{d.home.lead}</p>
            <div className="stats" aria-label="Statistics">
              <div className="stat">
                <strong className="tabular">
                  {total === null ? '–' : formatNumber(total, locale)}
                </strong>
                <span className="small muted">{d.home.statOpen}</span>
              </div>
              <div className="stat">
                <strong className="tabular">
                  {cats.kind === 'ok' ? formatNumber(cats.data.length, locale) : '–'}
                </strong>
                <span className="small muted">{d.home.statCategories}</span>
              </div>
              <div className="stat">
                <Icon name="shield" className="lg" />
                <span className="small muted" style={{ display: 'block' }}>
                  {d.home.statVerified}
                </span>
              </div>
            </div>
          </div>
          <div className="search-card">
            <form action={`/${locale}/search`} role="search" className="searchbar">
              <label htmlFor="q" className="sr-only">
                {d.home.searchLabel}
              </label>
              <input
                id="q"
                name="q"
                className="input"
                placeholder={d.home.searchPlaceholder}
                autoComplete="off"
              />
              <button className="btn" type="submit">
                <Icon name="search" /> {d.home.searchButton}
              </button>
            </form>
            <div className="quick-links">
              <span className="muted small" style={{ alignSelf: 'center' }}>
                {d.home.popular}
              </span>
              {tiles.map((t) => (
                <Link
                  key={t.slug}
                  className="badge"
                  href={`/${locale}/opportunities?category=${t.slug}`}
                >
                  {t.title}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <section className="section" aria-labelledby="tiles-h">
          <div className="section-head">
            <h2 id="tiles-h">{d.home.tilesTitle}</h2>
          </div>
          <div className="tiles">
            {tiles.map((t) => (
              <Link
                key={t.slug}
                className="tile"
                href={`/${locale}/opportunities?category=${t.slug}`}
              >
                <span className="tile-icon">
                  <Icon name={t.icon} size="lg" />
                </span>
                <span>
                  <h3>
                    {t.title} <span className="muted tabular small">({countFor(t.slug)})</span>
                  </h3>
                  <p>{t.text}</p>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {soon.kind === 'ok' && soon.data.length > 0 ? (
          <section className="section" aria-labelledby="soon-h">
            <div className="section-head">
              <h2 id="soon-h">{d.home.closingSoon}</h2>
              <Link href={`/${locale}/opportunities`}>
                {d.common.viewAll} <Icon name="arrow" size="sm" />
              </Link>
            </div>
            <OpportunityList
              items={soon.data}
              locale={locale}
              dict={d}
              now={now}
              savedIds={savedIds}
              nextPath={`/${locale}`}
            />
          </section>
        ) : null}

        {newest.kind === 'ok' && newest.data.length > 0 ? (
          <section className="section" aria-labelledby="new-h">
            <div className="section-head">
              <h2 id="new-h">{d.home.latest}</h2>
              <Link href={`/${locale}/opportunities?sort=newest`}>
                {d.common.viewAll} <Icon name="arrow" size="sm" />
              </Link>
            </div>
            <OpportunityList
              items={newest.data}
              locale={locale}
              dict={d}
              now={now}
              savedIds={savedIds}
              nextPath={`/${locale}`}
            />
          </section>
        ) : null}

        <section className="section" aria-labelledby="how-h">
          <div className="section-head">
            <h2 id="how-h">{d.home.howTitle}</h2>
          </div>
          <div className="steps">
            <div className="step">
              <h3>{d.home.step1Title}</h3>
              <p>{d.home.step1Text}</p>
            </div>
            <div className="step">
              <h3>{d.home.step2Title}</h3>
              <p>{d.home.step2Text}</p>
            </div>
            <div className="step">
              <h3>{d.home.step3Title}</h3>
              <p>{d.home.step3Text}</p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <Icon name="shield" className="lg" />
            <div>
              <h3 style={{ margin: '0 0 4px' }}>{d.home.trustTitle}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {d.home.trustText}
              </p>
            </div>
          </div>
        </section>

        {!me ? (
          <div className="cta-band">
            <div>
              <h2>{d.home.ctaTitle}</h2>
              <p>{d.home.ctaText}</p>
            </div>
            <Link className="btn" href={`/${locale}/register`}>
              {d.home.ctaButton}
            </Link>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
