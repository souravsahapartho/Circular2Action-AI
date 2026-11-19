import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TrackedExternalLink } from '@/components/beacons';
import { Page } from '@/components/chrome';
import { Badge, EmptyState, Icon } from '@/components/ui';
import { SOURCE_LABEL, WebJobCard, type WebJob } from '@/components/web-job-card';
import { formatDate, isLocale } from '@/i18n/config';
import { getDictionary, t } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { getMe } from '@/lib/session';
import { safeHref } from '@/lib/urls';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job from the web', robots: { index: false } };

type Detail = WebJob & { description: string | null };

/** Plain text in paragraphs and bullet lists. Never rendered as HTML, so nothing in a feed can inject markup. */
function Description({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim());
  return (
    <div className="job-description">
      {blocks.map((block, i) => {
        const lines = block.split('\n').map((l) => l.trim());
        if (lines.every((l) => l.startsWith('• '))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {l}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default async function WebJobPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  if (!/^\d{1,20}$/.test(id)) notFound();
  const d = getDictionary(locale);
  const me = await getMe();
  const res = await apiGet<Detail>(`/api/v1/listings/${id}`);
  if (res.kind === 'not_found') {
    return (
      <Page locale={locale} dict={d} section="webjobs" path={`/web-jobs/${id}`} me={me}>
        <EmptyState icon="info" title={d.webJobs.notFound} text={d.webJobs.notFoundText} />
        <p>
          <Link className="btn" href={`/${locale}/web-jobs`}>
            {d.webJobs.backToList}
          </Link>
        </p>
      </Page>
    );
  }
  if (res.kind !== 'ok') notFound();
  const job = res.data;
  const href = safeHref(job.url);
  const source = SOURCE_LABEL[job.source] ?? job.source;
  const [similar, cats] = await Promise.all([
    apiGet<WebJob[]>(
      `/api/v1/listings?limit=5${job.category_slug ? `&category=${job.category_slug}` : ''}`,
    ),
    apiGet<Array<{ slug: string; name: string }>>(`/api/v1/categories?locale=${locale}`),
  ]);
  const kind =
    cats.kind === 'ok' ? cats.data.find((c) => c.slug === job.category_slug)?.name : undefined;
  const more = similar.kind === 'ok' ? similar.data.filter((j) => j.id !== job.id).slice(0, 3) : [];
  const apply = href ? (
    me ? (
      <TrackedExternalLink href={href} listingId={job.id} className="btn block">
        <Icon name="external" size="sm" /> {t(d.webJobs.applyOn, { source })}
      </TrackedExternalLink>
    ) : (
      <a className="btn block" href={href} rel="noopener nofollow" target="_blank">
        <Icon name="external" size="sm" /> {t(d.webJobs.applyOn, { source })}
      </a>
    )
  ) : null;

  return (
    <Page locale={locale} dict={d} section="webjobs" path={`/web-jobs/${id}`} me={me}>
      <p>
        <Link href={`/${locale}/web-jobs`}>← {d.webJobs.backToList}</Link>
      </p>
      <div className="detail">
        <article>
          <div className="row-flex" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <Badge tone="info">
              <Icon name="globe" size="sm" /> {d.webJobs.fromWeb}
            </Badge>
            {kind ? <Badge tone="neutral">{kind}</Badge> : null}
            <span className="muted small">{t(d.webJobs.via, { source })}</span>
          </div>
          <h1 style={{ marginTop: 0 }}>{job.title}</h1>
          {job.company ? (
            <p className="muted row-flex" style={{ gap: 6 }}>
              <Icon name="building" size="sm" /> {job.company}
            </p>
          ) : null}
          <dl className="facts" style={{ margin: '16px 0 8px' }}>
            {job.location ? (
              <div>
                <dt>{d.webJobs.location}</dt>
                <dd>{job.location}</dd>
              </div>
            ) : null}
            {job.posted_at ? (
              <div>
                <dt>{t(d.webJobs.posted, { date: '' }).trim() || 'Posted'}</dt>
                <dd className="tabular">{formatDate(job.posted_at, locale)}</dd>
              </div>
            ) : null}
            <div>
              <dt>{d.webJobs.sourceInfo}</dt>
              <dd>{source}</dd>
            </div>
          </dl>
          <p className="notice-strip">
            <Icon name="info" /> {d.webJobs.notice}
          </p>
          <h2>{d.webJobs.aboutJob}</h2>
          {job.description ? (
            <Description text={job.description} />
          ) : job.snippet ? (
            <p>{job.snippet}</p>
          ) : (
            <p className="muted">{d.webJobs.noDescription}</p>
          )}
          {job.tags.length > 0 ? (
            <div className="chips" aria-hidden="false">
              {job.tags.slice(0, 8).map((x) => (
                <span key={x} className="chip">
                  {x}
                </span>
              ))}
            </div>
          ) : null}
        </article>
        <aside className="aside-sticky">
          <div className="card stack">
            {apply}
            <p className="muted small" style={{ margin: 0 }}>
              {d.webJobs.applyHint}
            </p>
          </div>
        </aside>
      </div>
      {apply ? <div className="apply-bar">{apply}</div> : null}
      {more.length > 0 ? (
        <section className="section" aria-labelledby="more-h">
          <div className="section-head">
            <h2 id="more-h">{d.webJobs.similarTitle}</h2>
          </div>
          <div className="stack">
            {more.map((j) => (
              <WebJobCard key={j.id} job={j} locale={locale} d={d} tracked={me !== null} />
            ))}
          </div>
        </section>
      ) : null}
    </Page>
  );
}
