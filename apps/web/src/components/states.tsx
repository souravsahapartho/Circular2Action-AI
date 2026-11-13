import Link from 'next/link';
import type { EligibilityStatus } from '@c2a/eligibility';
import { daysUntil, formatDate, type Locale } from '@/i18n/config';
import { t, type Dictionary } from '@/i18n/dictionaries';
import type { OpportunitySummary } from '@/lib/api';

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="state" aria-live="polite">
      <h2>{title}</h2>
      <p className="muted">{text}</p>
    </section>
  );
}

export function ErrorState({ dict }: { dict: Dictionary }) {
  return (
    <section className="state" role="alert">
      <h2>{dict.states.errorTitle}</h2>
      <p>{dict.states.errorText}</p>
      <p className="muted">{dict.states.backendAsleep}</p>
    </section>
  );
}

const ICON: Record<EligibilityStatus, string> = {
  eligible: '✓',
  not_eligible: '✕',
  needs_verification: '⌕',
  insufficient_information: '?',
};

/** Status is shown by icon shape + text label + colour (plan 6.4: never colour alone). */
export function StatusBadge({ status, dict }: { status: EligibilityStatus; dict: Dictionary }) {
  return (
    <span className={`status ${status}`}>
      <span aria-hidden="true">{ICON[status]}</span>
      {dict.eligibility[status]}
    </span>
  );
}

export function DeadlineChip({
  iso,
  locale,
  dict,
  now,
}: {
  iso: string;
  locale: Locale;
  dict: Dictionary;
  now: Date;
}) {
  const d = daysUntil(iso, now);
  const label =
    d < 0
      ? dict.explore.closed
      : d === 0
        ? dict.explore.today
        : t(dict.explore.daysLeft, {
            n: new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB').format(d),
          });
  return (
    <span>
      <time dateTime={iso} className="tabular">
        {formatDate(iso, locale)}
      </time>{' '}
      <span className={`chip-deadline${d < 0 ? ' closed' : ''}`}>{label}</span>
    </span>
  );
}

export function OpportunityRows({
  items,
  locale,
  dict,
  now,
}: {
  items: OpportunitySummary[];
  locale: Locale;
  dict: Dictionary;
  now: Date;
}) {
  return (
    <ul className="rows">
      {items.map((o) => (
        <li key={o.id} className="row">
          <div>
            <h3>
              <Link href={`/${locale}/opportunities/${o.slug}-${o.id}`}>{o.title}</Link>
            </h3>
            <div className="meta">{o.organization}</div>
          </div>
          <div className="meta">{o.location ?? ''}</div>
          <div>
            {o.deadline_at ? (
              <DeadlineChip iso={o.deadline_at} locale={locale} dict={dict} now={now} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
