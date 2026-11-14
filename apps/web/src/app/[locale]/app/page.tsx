import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { Alert, Badge, DeadlineChip, Icon } from '@/components/ui';
import { formatNumber, isLocale } from '@/i18n/config';
import { getDictionary, t } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { ForYou } from '@/components/for-you';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

interface App {
  id: string;
  title: string;
  organization: string | null;
  deadline_at: string | null;
  status: string;
}

export default async function Dashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app`);
  const [prof, apps, savedIds, cats] = await Promise.all([
    apiGet<{ completeness: number }>('/api/v1/me/profile', { auth: true }),
    apiGet<App[]>('/api/v1/me/applications', { auth: true }),
    apiGet<string[]>('/api/v1/me/saved-ids', { auth: true }),
    apiGet<Array<{ slug: string; name: string }>>(`/api/v1/categories?locale=${locale}`),
  ]);
  const categoryNames = Object.fromEntries(
    (cats.kind === 'ok' ? cats.data : []).map((c) => [c.slug, c.name]),
  );
  const completeness = prof.kind === 'ok' ? prof.data.completeness : 0;
  const list = apps.kind === 'ok' ? apps.data : [];
  const now = new Date();
  const upcoming = list
    .filter(
      (a) =>
        a.deadline_at &&
        new Date(a.deadline_at) > now &&
        !['selected', 'rejected', 'withdrawn', 'applied'].includes(a.status),
    )
    .slice(0, 5);
  const nf = (n: number) => formatNumber(n, locale);
  return (
    <Page locale={locale} dict={d} section="dashboard" path="/app" me={me}>
      <h1>{t(d.app.welcome, { name: me.display_name })}</h1>
      <div className="grid-cards" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>
            {d.app.savedCount}
          </p>
          <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }} className="tabular">
            {savedIds.kind === 'ok' ? nf(savedIds.data.length) : '–'}
          </p>
          <Link href={`/${locale}/app/saved`}>{d.common.viewAll}</Link>
        </div>
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>
            {d.app.trackingCount}
          </p>
          <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }} className="tabular">
            {nf(list.length)}
          </p>
          <Link href={`/${locale}/app/tracker`}>{d.common.viewAll}</Link>
        </div>
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>
            {d.app.completeness}
          </p>
          <p style={{ fontSize: '2rem', fontWeight: 700, margin: '0 0 8px' }} className="tabular">
            {nf(completeness)}%
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={completeness}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${completeness}%` }} />
          </div>
        </div>
      </div>

      {completeness < 100 ? (
        <Alert kind="info" role="note">
          {d.app.completeProfile} <Link href={`/${locale}/app/profile`}>{d.nav.profile}</Link>
        </Alert>
      ) : null}

      <ForYou
        locale={locale}
        d={d}
        savedIds={new Set(savedIds.kind === 'ok' ? savedIds.data : [])}
        nextPath={`/${locale}/app`}
        limit={5}
        categoryNames={categoryNames}
      />

      <h2>{d.app.upcoming}</h2>
      {upcoming.length > 0 ? (
        <ul className="opp-list">
          {upcoming.map((a) => (
            <li key={a.id} className="opp">
              <div>
                <h3>
                  <Link href={`/${locale}/app/tracker/${a.id}`}>{a.title}</Link>
                </h3>
                <div className="meta">
                  {a.organization ? <span>{a.organization}</span> : null}
                  <Badge tone="neutral">
                    {d.tracker[`s_${a.status}` as keyof typeof d.tracker] as string}
                  </Badge>
                </div>
              </div>
              <div className="side">
                {a.deadline_at ? (
                  <DeadlineChip iso={a.deadline_at} locale={locale} dict={d} now={now} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{d.app.noUpcoming}</p>
      )}

      <h2>{d.app.shortcuts}</h2>
      <div className="row-flex">
        <Link className="btn" href={`/${locale}/opportunities`}>
          <Icon name="search" /> {d.app.browse}
        </Link>
        <Link className="btn secondary" href={`/${locale}/app/profile`}>
          <Icon name="user" /> {d.nav.profile}
        </Link>
        <Link className="btn secondary" href={`/${locale}/app/tracker`}>
          <Icon name="list" /> {d.nav.tracker}
        </Link>
      </div>
    </Page>
  );
}
