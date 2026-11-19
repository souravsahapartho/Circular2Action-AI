import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { CopyButton } from '@/components/copy-button';
import {
  ProgressSteps,
  SiteStatusPill,
  Timeline,
  type TimelineItem,
} from '@/components/site-application';
import { ErrorState } from '@/components/ui';
import { formatDate, isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet } from '@/lib/api';
import { getMe } from '@/lib/session';
import { titleFor } from '@/lib/titles';
import { TrackForm } from '../track-form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

interface Tracked {
  tracking_code: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  opportunity: {
    title: string;
    title_alt: string | null;
    organization: string;
    organization_bn: string;
  };
  timeline: Array<{ id: string; to_status: string; note: string | null; at: string }>;
}

export default async function TrackResult({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await getMe();
  const res = await apiGet<Tracked>(`/api/v1/track/${encodeURIComponent(code)}`);
  return (
    <Page locale={locale} dict={d} section="track" path={`/track/${code}`} me={me}>
      <div className="narrow">
        {res.kind === 'ok' ? (
          <>
            <h1>{d.track.title}</h1>
            <div className="card stack">
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <div className="row-flex">
                  <code className="tracking-code">{res.data.tracking_code}</code>
                  <CopyButton
                    value={res.data.tracking_code}
                    label={locale === 'bn' ? 'কপি' : 'Copy'}
                    doneLabel={locale === 'bn' ? 'কপি হয়েছে' : 'Copied'}
                  />
                </div>
                <SiteStatusPill d={d} status={res.data.status} />
              </div>
              <ProgressSteps
                d={d}
                status={res.data.status}
                reached={res.data.timeline.map((t) => t.to_status)}
              />
              <div>
                <strong>
                  {titleFor(res.data.opportunity.title, res.data.opportunity.title_alt, locale)}
                </strong>
                <p className="muted small" style={{ margin: 0 }}>
                  {locale === 'bn'
                    ? res.data.opportunity.organization_bn
                    : res.data.opportunity.organization}
                </p>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {d.track.submittedOn} {formatDate(res.data.submitted_at, locale)} ·{' '}
                {d.track.lastUpdate} {formatDate(res.data.updated_at, locale)}
              </p>
              <h2 style={{ margin: '8px 0 0', fontSize: '1.0625rem' }}>{d.track.timeline}</h2>
              <Timeline d={d} locale={locale} items={res.data.timeline as TimelineItem[]} />
            </div>
            <p className="muted small" style={{ marginTop: 16 }}>
              {d.track.privacy}
            </p>
            <p>
              <Link href={`/${locale}/track`}>{d.track.another}</Link>
            </p>
          </>
        ) : res.kind === 'not_found' ? (
          <>
            <h1>{d.track.title}</h1>
            <TrackForm locale={locale} labels={d.track} initial={code} error={d.track.notFound} />
          </>
        ) : res.kind === 'unavailable' && res.status === 429 ? (
          <>
            <h1>{d.track.title}</h1>
            <TrackForm locale={locale} labels={d.track} initial={code} error={d.track.tooMany} />
          </>
        ) : (
          <ErrorState dict={d} />
        )}
      </div>
    </Page>
  );
}
