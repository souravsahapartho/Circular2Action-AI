import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { ForYou } from '@/components/for-you';
import { OpportunityList } from '@/components/opportunity-list';
import { DeadlineChip, Icon, type IconName } from '@/components/ui';
import { WebJobCard, type WebJob } from '@/components/web-job-card';
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
  const [cats, soon, newest, saved, web] = await Promise.all([
    apiGet<CategoryInfo[]>(`/api/v1/categories?locale=${locale}`),
    apiGet<OpportunitySummary[]>(`/api/v1/opportunities?locale=${locale}&limit=4`),
    apiGet<OpportunitySummary[]>(`/api/v1/opportunities?locale=${locale}&limit=4&sort=newest`),
    me ? apiGet<string[]>('/api/v1/me/saved-ids', { auth: true }) : Promise.resolve(null),
    apiGet<WebJob[]>('/api/v1/listings?limit=4', { timeoutMs: 8000 }),
  ]);
  const savedIds = me ? new Set(saved && saved.kind === 'ok' ? saved.data : []) : null;
  const total = cats.kind === 'ok' ? cats.data.reduce((n, c) => n + c.count, 0) : null;
  const webTotal = web.kind === 'ok' ? (web.total ?? web.data.length) : null;
  const categoryNames = Object.fromEntries(
    (cats.kind === 'ok' ? cats.data : []).map((c) => [c.slug, c.name]),
  );
  const now = new Date();
  const nf = (n: number | null) => (n === null ? '–' : formatNumber(n, locale));
  const tiles: Array<{ slug: string; icon: IconName; title: string; text: string }> = [
    { slug: 'jobs', icon: 'briefcase', title: d.home.tileJobs, text: d.home.tileJobsText },
    {
      slug: 'internships',
      icon: 'users',
      title: d.home.tileInternships,
      text: d.home.tileInternshipsText,
    },
    {
      slug: 'scholarships',
      icon: 'graduation',
      title: d.home.tileScholarships,
      text: d.home.tileScholarshipsText,
    },
  ];
  const countFor = (slug: string) =>
    cats.kind === 'ok' ? nf(cats.data.find((c) => c.slug === slug)?.count ?? 0) : '–';
  const preview = soon.kind === 'ok' ? soon.data.slice(0, 3) : [];
  const features: Array<{ icon: IconName; title: string; text: string }> = [
    { icon: 'check', title: d.home2.f1Title, text: d.home2.f1Text },
    { icon: 'sliders', title: d.home2.f2Title, text: d.home2.f2Text },
    { icon: 'info', title: d.home2.f3Title, text: d.home2.f3Text },
    { icon: 'file', title: d.home2.f4Title, text: d.home2.f4Text },
    { icon: 'globe', title: d.home2.f5Title, text: d.home2.f5Text },
    { icon: 'user', title: d.home2.f6Title, text: d.home2.f6Text },
  ];
  const faq = [
    [d.home2.q1, d.home2.a1],
    [d.home2.q2, d.home2.a2],
    [d.home2.q3, d.home2.a3],
    [d.home2.q4, d.home2.a4],
  ] as const;

  return (
    <Page locale={locale} dict={d} section="home" path="" me={me} bare>
      <section className="hero2">
        <div className="hero2-blob b1" aria-hidden="true" />
        <div className="hero2-blob b2" aria-hidden="true" />
        <div className="container hero2-grid">
          <div className="hero2-copy">
            <span className="eyebrow">
              <Icon name="shield" size="sm" /> {d.home2.badge}
            </span>
            <h1>{d.home2.heroTitle}</h1>
            <p className="lead">{d.home2.heroLead}</p>
            <form action={`/${locale}/search`} role="search" className="hero2-search">
              <Icon name="search" />
              <label htmlFor="q" className="sr-only">
                {d.home.searchLabel}
              </label>
              <input
                id="q"
                name="q"
                placeholder={d.home.searchPlaceholder}
                autoComplete="off"
                className="hero2-input"
              />
              <button className="btn" type="submit">
                {d.home.searchButton}
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
            <div className="hero2-actions">
              <Link className="btn lg" href={`/${locale}/opportunities`}>
                {d.home2.ctaPrimary} <Icon name="arrow" />
              </Link>
              <Link className="btn secondary lg" href={`/${locale}/web-jobs`}>
                <Icon name="globe" /> {d.home2.ctaSecondary}
              </Link>
              {!me ? (
                <Link className="btn ghost lg" href={`/${locale}/register`}>
                  {d.home2.ctaCreate}
                </Link>
              ) : null}
            </div>
            <ul className="trust-row">
              {[d.home2.trust1, d.home2.trust2, d.home2.trust3].map((x) => (
                <li key={x}>
                  <Icon name="check" size="sm" /> {x}
                </li>
              ))}
            </ul>
          </div>

          <div className="hero2-visual" aria-label={d.home2.previewTitle}>
            <div className="float-chip c1">
              <Icon name="briefcase" size="sm" /> <strong>{nf(total)}</strong>{' '}
              <span>{d.home2.statsOpen}</span>
            </div>
            <div className="float-chip c2">
              <Icon name="globe" size="sm" /> <strong>{nf(webTotal)}</strong>{' '}
              <span>{d.home2.statsWeb}</span>
            </div>
            <div className="preview-stack">
              <p className="preview-title">
                <Icon name="clock" size="sm" /> {d.home2.previewTitle}
              </p>
              {preview.length > 0 ? (
                preview.map((o, i) => (
                  <Link
                    key={o.id}
                    href={`/${locale}/opportunities/${o.slug}-${o.id}`}
                    className={`preview-card p${i}`}
                  >
                    <span className="preview-icon">
                      <Icon
                        name={
                          o.category_slug === 'scholarships'
                            ? 'graduation'
                            : o.category_slug === 'internships'
                              ? 'users'
                              : 'briefcase'
                        }
                      />
                    </span>
                    <span className="preview-body">
                      <strong>{o.title}</strong>
                      <span className="muted small">{o.organization}</span>
                    </span>
                    {o.deadline_at ? (
                      <DeadlineChip iso={o.deadline_at} locale={locale} dict={d} now={now} />
                    ) : null}
                  </Link>
                ))
              ) : (
                <p className="muted small">{d.home.statVerified}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <section className="stat-band" aria-label="Statistics">
          <div>
            <strong className="tabular">{nf(total)}</strong>
            <span>{d.home2.statsOpen}</span>
          </div>
          <div>
            <strong className="tabular">{nf(webTotal)}</strong>
            <span>{d.home2.statsWeb}</span>
          </div>
          <div>
            <strong className="tabular">{cats.kind === 'ok' ? nf(cats.data.length) : '–'}</strong>
            <span>{d.home2.statsCats}</span>
          </div>
          <div>
            <Icon name="shield" className="lg" />
            <span>{d.home.statVerified}</span>
          </div>
        </section>

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

        {me ? (
          <ForYou
            locale={locale}
            d={d}
            savedIds={savedIds ?? new Set()}
            nextPath={`/${locale}`}
            categoryNames={categoryNames}
            limit={5}
          />
        ) : (
          <section className="section">
            <div className="teaser">
              <span className="teaser-icon">
                <Icon name="sliders" size="lg" />
              </span>
              <div>
                <h2 style={{ margin: 0 }}>{d.forYou.signInTitle}</h2>
                <p className="muted" style={{ margin: '4px 0 0', maxWidth: '60ch' }}>
                  {d.forYou.signInText}
                </p>
              </div>
              <Link className="btn" href={`/${locale}/register`}>
                {d.home.ctaButton}
              </Link>
            </div>
          </section>
        )}

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

        {web.kind === 'ok' && web.data.length > 0 ? (
          <section className="section" aria-labelledby="web-h">
            <div className="section-head">
              <div>
                <h2 id="web-h">{d.webJobs.homeTitle}</h2>
                <p className="muted small" style={{ margin: 0 }}>
                  {d.webJobs.homeText}
                </p>
              </div>
              <Link href={`/${locale}/web-jobs`}>
                {d.webJobs.seeAll} <Icon name="arrow" size="sm" />
              </Link>
            </div>
            <div className="grid-2">
              {web.data.map((j) => (
                <WebJobCard key={j.id} job={j} locale={locale} d={d} tracked={me !== null} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="section" aria-labelledby="why-h">
          <div className="section-head">
            <h2 id="why-h">{d.home2.featureTitle}</h2>
          </div>
          <div className="feature-grid">
            {features.map((f) => (
              <div key={f.title} className="feature">
                <span className="feature-icon">
                  <Icon name={f.icon} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="how-h">
          <div className="section-head">
            <h2 id="how-h">{d.home.howTitle}</h2>
          </div>
          <div className="steps">
            {[
              [d.home.step1Title, d.home.step1Text],
              [d.home.step2Title, d.home.step2Text],
              [d.home.step3Title, d.home.step3Text],
            ].map(([title, text], i) => (
              <div key={title} className="step">
                <span className="step-no">{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="faq-h">
          <div className="section-head">
            <h2 id="faq-h">{d.home2.faqTitle}</h2>
          </div>
          <div className="faq">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
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
