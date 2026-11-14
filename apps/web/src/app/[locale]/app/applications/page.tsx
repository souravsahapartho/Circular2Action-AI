import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { SiteStatusPill } from '@/components/site-application';
import { EmptyState, ErrorState } from '@/components/ui';
import { formatDate, isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { titleFor } from '@/lib/titles';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

interface Item {
  id: string;
  tracking_code: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  opportunity: {
    id: string;
    slug: string;
    title: string;
    title_alt: string | null;
    organization: string;
    organization_bn: string;
  };
}

export default async function MyApplications({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/applications`);
  const res = await apiGet<Item[]>('/api/v1/me/site-applications', { auth: true });
  return (
    <Page locale={locale} dict={d} section="applications" path="/app/applications" me={me}>
      <div className="row-flex" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{d.myApps.title}</h1>
        <Link className="btn secondary" href={`/${locale}/track`}>
          {d.apply.trackPage}
        </Link>
      </div>
      {res.kind === 'ok' && res.data.length > 0 ? (
        <div className="stack" style={{ marginTop: 20 }}>
          {res.data.map((a) => (
            <Link
              key={a.id}
              href={`/${locale}/app/applications/${a.id}`}
              className="card app-card"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <strong>{titleFor(a.opportunity.title, a.opportunity.title_alt, locale)}</strong>
                <SiteStatusPill d={d} status={a.status} />
              </div>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {locale === 'bn' ? a.opportunity.organization_bn : a.opportunity.organization}
              </p>
              <p className="small" style={{ margin: '8px 0 0' }}>
                {d.myApps.id}: <code className="tracking-code sm">{a.tracking_code}</code>
                <span className="muted">
                  {' '}
                  · {d.myApps.submitted} {formatDate(a.submitted_at, locale)}
                </span>
              </p>
            </Link>
          ))}
        </div>
      ) : res.kind === 'ok' ? (
        <EmptyState
          icon="file"
          title={d.myApps.empty}
          text={d.myApps.emptyText}
          action={
            <Link className="btn" href={`/${locale}/opportunities`}>
              {d.myApps.browse}
            </Link>
          }
        />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
