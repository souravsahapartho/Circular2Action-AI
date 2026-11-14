import { formatDate, type Locale } from '@/i18n/config';
import { t, type Dictionary } from '@/i18n/dictionaries';
import { safeHref } from '@/lib/urls';
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
  google: 'Google Search',
};

/** A job found on the web. Always labelled with its source and never presented as verified. */
export function WebJobCard({ job, locale, d }: { job: WebJob; locale: Locale; d: Dictionary }) {
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
      <div className="row-flex" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span className="muted small">{d.webJobs.notice}</span>
        {href ? (
          <a className="btn secondary sm" href={href} rel="noopener nofollow" target="_blank">
            <Icon name="external" size="sm" /> {d.webJobs.apply}
          </a>
        ) : null}
      </div>
    </article>
  );
}
