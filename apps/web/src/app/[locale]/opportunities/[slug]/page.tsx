import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { SaveButton } from '@/components/save-button';
import { TrackButton } from '@/components/track-button';
import {
  Alert,
  Badge,
  Breadcrumbs,
  DeadlineChip,
  EmptyState,
  ErrorState,
  Icon,
} from '@/components/ui';
import { formatNumber, isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, idFromSlug, safeHref, type OpportunityDetail } from '@/lib/api';
import { getMe } from '@/lib/session';

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
  const me = await getMe();
  const [res, savedIds, apps] = await Promise.all([
    id
      ? apiGet<OpportunityDetail>(`/api/v1/opportunities/${id}?locale=${locale}`)
      : Promise.resolve({ kind: 'not_found' } as const),
    me ? apiGet<string[]>('/api/v1/me/saved-ids', { auth: true }) : Promise.resolve(null),
    me
      ? apiGet<Array<{ id: string; opportunity_id: string | null }>>('/api/v1/me/applications', {
          auth: true,
        })
      : Promise.resolve(null),
  ]);
  const path = `/opportunities/${slug}`;
  const trackedId =
    apps && apps.kind === 'ok'
      ? (apps.data.find((a) => a.opportunity_id === id)?.id ?? null)
      : null;
  const isSaved = Boolean(
    me && savedIds && savedIds.kind === 'ok' && id && savedIds.data.includes(id),
  );

  if (res.kind !== 'ok') {
    return (
      <Page locale={locale} dict={d} section="explore" path={path} me={me}>
        {res.kind === 'not_found' ? (
          <EmptyState
            icon="search"
            title={d.detail.notFound}
            text={d.explore.emptyText}
            action={
              <Link className="btn" href={`/${locale}/opportunities`}>
                {d.nav.explore}
              </Link>
            }
          />
        ) : (
          <ErrorState dict={d} />
        )}
      </Page>
    );
  }

  const o = res.data;
  const sample = o.title.startsWith('[');
  const official = safeHref(o.source_url);
  const apply = safeHref(o.application_url);
  const now = new Date();
  return (
    <Page locale={locale} dict={d} section="explore" path={path} me={me}>
      <Breadcrumbs
        items={[
          { href: `/${locale}`, label: d.nav.home },
          { href: `/${locale}/opportunities`, label: d.nav.explore },
          ...(o.category_slug
            ? [
                {
                  href: `/${locale}/opportunities?category=${o.category_slug}`,
                  label: o.category ?? '',
                },
              ]
            : []),
          { label: o.title },
        ]}
      />
      <div className="detail">
        <article>
          <div className="row-flex" style={{ marginBottom: 8 }}>
            {o.category ? <Badge>{o.category}</Badge> : null}
            {o.verified ? (
              <Badge tone="success">
                <Icon name="shield" size="sm" /> {d.detail.verified}
              </Badge>
            ) : (
              <Badge tone="warn">{d.detail.unverified}</Badge>
            )}
          </div>
          <h1>{o.title}</h1>
          <p className="muted row-flex" style={{ gap: 6 }}>
            <Icon name="building" /> {o.organization}
          </p>
          {sample ? (
            <Alert kind="warn" role="note">
              {d.detail.sampleNotice}
            </Alert>
          ) : null}

          <dl className="facts" style={{ margin: '16px 0 8px' }}>
            {o.deadline_at ? (
              <div>
                <dt>{d.detail.deadline}</dt>
                <dd>
                  <DeadlineChip iso={o.deadline_at} locale={locale} dict={d} now={now} />
                </dd>
              </div>
            ) : null}
            {o.location ? (
              <div>
                <dt>{d.explore.location}</dt>
                <dd>{o.location}</dd>
              </div>
            ) : null}
            {o.vacancies ? (
              <div>
                <dt>{d.detail.vacancies}</dt>
                <dd className="tabular">{formatNumber(o.vacancies, locale)}</dd>
              </div>
            ) : null}
            {o.category ? (
              <div>
                <dt>{d.explore.category}</dt>
                <dd>{o.category}</dd>
              </div>
            ) : null}
          </dl>

          {o.summary ? (
            <>
              <h2>{d.detail.summary}</h2>
              <p style={{ maxWidth: '70ch' }}>{o.summary}</p>
            </>
          ) : null}

          <h2>{d.detail.requirements}</h2>
          {o.requirements && o.requirements.length > 0 ? (
            <ul className="req-list">
              {o.requirements.map((r) => (
                <li key={r.id}>
                  <span>{r.text ?? r.rule_type}</span>
                  <Badge tone={r.necessity === 'mandatory' ? 'neutral' : 'info'}>
                    {r.necessity === 'mandatory' ? d.detail.mandatory : d.detail.preferred}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{d.detail.noRequirements}</p>
          )}

          {o.how_to_apply ? (
            <>
              <h2>{d.detail.apply}</h2>
              <p style={{ maxWidth: '70ch', whiteSpace: 'pre-line' }}>{o.how_to_apply}</p>
            </>
          ) : null}
        </article>

        <aside className="aside-sticky">
          <div className="card stack">
            <h2 style={{ fontSize: '1.0625rem', margin: 0 }}>{d.detail.actions}</h2>
            <Link className="btn block" href={`/${locale}/opportunities/${slug}/eligibility`}>
              <Icon name="check" /> {d.detail.checkEligibility}
            </Link>
            <TrackButton
              opportunityId={o.id}
              signedIn={me !== null}
              locale={locale}
              nextPath={`/${locale}${path}`}
              initialTrackedId={trackedId}
              labels={{
                track: d.detail.track,
                tracking: d.detail.tracking,
                signIn: d.detail.signInToSave,
              }}
              errors={d.errors}
            />
            <SaveButton
              opportunityId={o.id}
              initialSaved={isSaved}
              signedIn={me !== null}
              locale={locale}
              nextPath={`/${locale}${path}`}
              labels={{ save: d.detail.save, saved: d.detail.saved, signIn: d.detail.signInToSave }}
              variant="button"
            />
            {apply ? (
              <a
                className="btn secondary block"
                href={apply}
                rel="noopener nofollow"
                target="_blank"
              >
                <Icon name="external" /> {d.detail.applyLink}
              </a>
            ) : null}
            {official ? (
              <a
                className="btn ghost block"
                href={official}
                rel="noopener nofollow"
                target="_blank"
              >
                <Icon name="file" /> {d.detail.official}
              </a>
            ) : null}
          </div>
        </aside>
      </div>
    </Page>
  );
}
