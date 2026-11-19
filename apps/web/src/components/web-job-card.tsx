import { formatDate, type Locale } from '@/i18n/config';
import { t, type Dictionary } from '@/i18n/dictionaries';
import { reasonText, type Reason } from '@/lib/reasons';
import { safeHref } from '@/lib/urls';
import { TrackedExternalLink } from './beacons';
import { Icon } from './ui';

export interface WebJob {
  id: string;
  source: string;
  title: string;
  company: string | null;
  location: string | null;
  snippet: string | null;
  url: string;
  tags: string[];
  posted_at: string | null;
}

export const SOURCE_LABEL: Record<string, string> = {
  arbeitnow: 'Arbeitnow',
  remotive: 'Remotive',
  jobicy: 'Jobicy',
  remoteok: 'Remote OK',
  himalayas: 'Himalayas',
  greenhouse: 'Company career page',
  lever: 'Company career page',
  google: 'Google Search',
};

/** A job found on the web. Always labelled with its source and never presented as verified. */
export function WebJobCard({
  job,
  locale,
  d,
  tracked = false,
  reasons,
  categoryNames,
}: {
  job: WebJob;
  locale: Locale;
  d: Dictionary;
  /** record clicks as activity (signed-in pages only; the API ignores it when personalisation is off) */
  tracked?: boolean;
  reasons?: Reason[];
  categoryNames?: Record<string, string>;
}) {
  const chips = (reasons ?? [])
    .map((r) => reasonText(d, r, categoryNames ?? {}))
    .filter((x): x is string => x !== null);
  const href = safeHref(job.url);
  const source = SOURCE_LABEL[job.source] ?? job.source;
  return (
    <article className="card web-job">
      <div className="row-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="badge info">
          <Icon name="globe" size="sm" /> {d.webJobs.fromWeb}
        </span>
        <span className="muted small">{t(d.webJobs.via, { source })}</span>
      </div>
      <h3 style={{ margin: '8px 0 2px' }}>{job.title}</h3>
      <p className="muted small" style={{ margin: 0 }}>
        {[job.company, job.location].filter(Boolean).join(' · ')}
        {job.posted_at
          ? `${job.company || job.location ? ' · ' : ''}${t(d.webJobs.posted, {
              date: formatDate(job.posted_at, locale),
            })}`
          : ''}
      </p>
      {job.snippet ? <p className="web-job-snippet">{job.snippet}</p> : null}
      {chips.length > 0 ? (
        <div className="reasons" aria-label={d.forYou.why}>
          {chips.map((x) => (
            <span key={x} className="reason">
              <Icon name="check" size="sm" /> {x}
            </span>
          ))}
        </div>
      ) : null}
      <div className="row-flex" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span className="muted small">{d.webJobs.notice}</span>
        {href ? (
          tracked ? (
            <TrackedExternalLink href={href} listingId={job.id} className="btn secondary sm">
              <Icon name="external" size="sm" /> {d.webJobs.apply}
            </TrackedExternalLink>
          ) : (
            <a className="btn secondary sm" href={href} rel="noopener nofollow" target="_blank">
              <Icon name="external" size="sm" /> {d.webJobs.apply}
            </a>
          )
        ) : null}
      </div>
    </article>
  );
}
