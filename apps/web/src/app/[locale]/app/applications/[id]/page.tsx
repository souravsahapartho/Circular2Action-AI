import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import {
  ProgressSteps,
  SiteStatusPill,
  Timeline,
  type TimelineItem,
} from '@/components/site-application';
import { EmptyState, ErrorState } from '@/components/ui';
import { formatDate, isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { titleFor } from '@/lib/titles';
import { WithdrawButton } from './withdraw-button';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

interface Detail {
  id: string;
  tracking_code: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  applicant_phone: string | null;
  cover_note: string | null;
  eligibility_status: string | null;
  opportunity: {
    id: string;
    slug: string;
    title: string;
    title_alt: string | null;
    organization: string;
  };
  timeline: Array<{ id: string; to_status: string; note: string | null; at: string }>;
}

export default async function MyApplication({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/applications/${id}`);
  const res = /^\d{1,20}$/.test(id)
    ? await apiGet<Detail>(`/api/v1/me/site-applications/${id}`, { auth: true })
    : ({ kind: 'not_found' } as const);
  return (
    <Page locale={locale} dict={d} section="applications" path={`/app/applications/${id}`} me={me}>
      {res.kind === 'ok' ? (
        <>
          <p className="small">
            <Link href={`/${locale}/app/applications`}>← {d.myApps.back}</Link>
          </p>
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <h1 style={{ margin: 0 }}>
              {titleFor(res.data.opportunity.title, res.data.opportunity.title_alt, locale)}
            </h1>
            <SiteStatusPill d={d} status={res.data.status} />
          </div>
          <p className="muted">{res.data.opportunity.organization}</p>
          <div className="detail">
            <article>
              <div className="card success-card">
                <p className="small muted" style={{ margin: 0 }}>
                  {d.myApps.id}
                </p>
                <code className="tracking-code">{res.data.tracking_code}</code>
              </div>
              <ProgressSteps
                d={d}
                status={res.data.status}
                reached={(res.data.timeline as TimelineItem[]).map((t) => t.to_status)}
              />
              <h2>{d.myApps.timeline}</h2>
              <Timeline d={d} locale={locale} items={res.data.timeline as TimelineItem[]} />
            </article>
            <aside>
              <div className="card stack">
                <dl className="facts">
                  <div>
                    <dt>{d.myApps.submitted}</dt>
                    <dd>{formatDate(res.data.submitted_at, locale)}</dd>
                  </div>
                  <div>
                    <dt>{d.myApps.updated}</dt>
                    <dd>{formatDate(res.data.updated_at, locale)}</dd>
                  </div>
                  {res.data.applicant_phone ? (
                    <div>
                      <dt>{d.myApps.phone}</dt>
                      <dd>{res.data.applicant_phone}</dd>
                    </div>
                  ) : null}
                  {res.data.eligibility_status ? (
                    <div>
                      <dt>{d.myApps.eligibility}</dt>
                      <dd>
                        {(d.eligibility as Record<string, string>)[res.data.eligibility_status] ??
                          res.data.eligibility_status}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {res.data.cover_note ? (
                  <div>
                    <p className="small muted" style={{ margin: '0 0 4px' }}>
                      {d.myApps.note}
                    </p>
                    <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{res.data.cover_note}</p>
                  </div>
                ) : null}
                <Link
                  className="btn secondary"
                  href={`/${locale}/opportunities/${res.data.opportunity.slug}-${res.data.opportunity.id}`}
                >
                  {d.myApps.opportunity}
                </Link>
                {['accepted', 'rejected', 'withdrawn'].includes(res.data.status) ? null : (
                  <WithdrawButton
                    id={res.data.id}
                    labels={{
                      withdraw: d.myApps.withdraw,
                      confirm: d.myApps.withdrawConfirm,
                    }}
                    errors={d.errors}
                  />
                )}
              </div>
            </aside>
          </div>
        </>
      ) : res.kind === 'not_found' ? (
        <EmptyState icon="file" title={d.detail.notFound} text={d.myApps.emptyText} />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
