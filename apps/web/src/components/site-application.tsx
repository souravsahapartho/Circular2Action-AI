import { formatDate, type Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

export type SiteStatus =
  | 'submitted'
  | 'under_review'
  | 'shortlisted'
  | 'interview'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

export interface TimelineItem {
  id: string;
  to_status: string;
  note: string | null;
  at: string;
  public?: boolean;
  by_staff?: boolean;
}

export function statusLabel(d: Dictionary, status: string): string {
  return (d.statuses as Record<string, string>)[status] ?? status;
}

/** A coloured status pill used on the applicant pages, the tracking page and in the staff portal. */
export function SiteStatusPill({ d, status }: { d: Dictionary; status: string }) {
  return <span className={`pill pill-${status}`}>{statusLabel(d, status)}</span>;
}

/** Vertical timeline of an application: newest last, with the note staff chose to show. */
export function Timeline({
  d,
  locale,
  items,
  staffView = false,
}: {
  d: Dictionary;
  locale: Locale;
  items: TimelineItem[];
  staffView?: boolean;
}) {
  return (
    <ol className="timeline">
      {items.map((e, i) => (
        <li key={e.id} className={i === items.length - 1 ? 'current' : undefined}>
          <span className="dot" aria-hidden="true" />
          <div>
            <strong>{statusLabel(d, e.to_status)}</strong>
            <span className="muted small"> · {formatDate(e.at, locale)}</span>
            {staffView && e.by_staff && e.public === false ? (
              <span className="badge neutral" style={{ marginLeft: 8 }}>
                private
              </span>
            ) : null}
            {e.note ? <p className="muted small timeline-note">{e.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

const STEPS: SiteStatus[] = ['submitted', 'under_review', 'shortlisted', 'interview', 'accepted'];

/**
 * A horizontal progress bar of the main path (submitted to accepted). A rejected or withdrawn application shows the
 * steps it reached, then an end marker. Phones show it as a vertical list so nothing needs to scroll sideways.
 */
export function ProgressSteps({
  d,
  status,
  reached,
}: {
  d: Dictionary;
  status: string;
  /** every status the application has had, from the timeline */
  reached: string[];
}) {
  const ended = status === 'rejected' || status === 'withdrawn';
  const seen = new Set(reached);
  const lastIdx = Math.max(-1, ...STEPS.map((s, i) => (seen.has(s) ? i : -1)));
  const currentIdx = ended ? lastIdx : STEPS.indexOf(status as SiteStatus);
  return (
    <ol className="steps" aria-label={statusLabel(d, status)}>
      {STEPS.map((s, i) => {
        const state =
          i < currentIdx ? 'done' : i === currentIdx ? (ended ? 'done' : 'now') : 'todo';
        return (
          <li
            key={s}
            className={`step ${state}`}
            aria-current={state === 'now' ? 'step' : undefined}
          >
            <span className="step-dot" aria-hidden="true">
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className="step-label">{statusLabel(d, s)}</span>
          </li>
        );
      })}
      {ended ? (
        <li className={`step end ${status}`}>
          <span className="step-dot" aria-hidden="true">
            ✕
          </span>
          <span className="step-label">{statusLabel(d, status)}</span>
        </li>
      ) : null}
    </ol>
  );
}
