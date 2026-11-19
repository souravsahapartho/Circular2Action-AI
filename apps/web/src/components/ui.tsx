import Link from 'next/link';
import type { ReactNode } from 'react';
import type { EligibilityStatus } from '@c2a/eligibility';
import { daysUntil, formatDate, type Locale } from '@/i18n/config';
import { t, type Dictionary } from '@/i18n/dictionaries';

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  briefcase:
    '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  graduation: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash:
    '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  external:
    '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  alert:
    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  dashboard:
    '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  home: '<path d="m3 11 9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  building:
    '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size,
  className,
}: {
  name: IconName;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <svg
      className={`icon${size ? ` ${size}` : ''}${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

export function Logo({ locale }: { locale: Locale }) {
  return (
    <Link
      href={locale === 'bn' || locale === 'en' ? `/${locale}` : '/'}
      className="logo"
      aria-label="Circular2Action"
    >
      <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#0b5d5e" />
        <path
          d="M9 17.5 14 22.5 23.5 10"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="24" r="3" fill="#e8a213" />
      </svg>
      <span>
        Circular<span className="two">2</span>Action
      </span>
    </Link>
  );
}

export function Alert({
  kind = 'info',
  children,
  role,
}: {
  kind?: 'info' | 'success' | 'error' | 'warn';
  children: ReactNode;
  role?: 'alert' | 'status' | 'note';
}) {
  const icon: IconName =
    kind === 'success' ? 'check' : kind === 'error' || kind === 'warn' ? 'alert' : 'info';
  return (
    <div className={`alert ${kind}`} role={role ?? (kind === 'error' ? 'alert' : 'status')}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function Badge({
  tone = 'brand',
  children,
}: {
  tone?: 'brand' | 'neutral' | 'success' | 'danger' | 'warn' | 'info';
  children: ReactNode;
}) {
  return <span className={`badge${tone === 'brand' ? '' : ` ${tone}`}`}>{children}</span>;
}

export function EmptyState({
  title,
  text,
  icon = 'file',
  action,
}: {
  title: string;
  text?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <section className="state" aria-live="polite">
      <Icon name={icon} />
      <h2>{title}</h2>
      {text ? <p className="muted">{text}</p> : null}
      {action ? (
        <div className="row-flex" style={{ justifyContent: 'center' }}>
          {action}
        </div>
      ) : null}
    </section>
  );
}

export function ErrorState({ dict }: { dict: Dictionary }) {
  return (
    <section className="state" role="alert">
      <Icon name="alert" />
      <h2>{dict.states.errorTitle}</h2>
      <p>{dict.states.errorText}</p>
      <p className="muted small">{dict.states.backendAsleep}</p>
    </section>
  );
}

export function Breadcrumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 ? <span aria-hidden="true"> › </span> : null}
          {it.href ? (
            <Link href={it.href}>{it.label}</Link>
          ) : (
            <span aria-current="page">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

const ICON: Record<EligibilityStatus, string> = {
  eligible: '✓',
  not_eligible: '✕',
  needs_verification: '⌕',
  insufficient_information: '?',
};

/** Status is shown by icon shape + text label + colour (plan 6.4: never colour alone). */
export function StatusBadge({ status, label }: { status: EligibilityStatus; label: string }) {
  return (
    <span className={`status ${status}`}>
      <span aria-hidden="true">{ICON[status]}</span>
      {label}
    </span>
  );
}

export function DeadlineChip({
  iso,
  locale,
  dict,
  now,
  withDate = true,
}: {
  iso: string;
  locale: Locale;
  dict: Dictionary;
  now: Date;
  withDate?: boolean;
}) {
  const d = daysUntil(iso, now);
  const nf = new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB');
  const label =
    d < 0
      ? dict.explore.closed
      : d === 0
        ? dict.explore.today
        : t(dict.explore.daysLeft, { n: nf.format(d) });
  return (
    <span className="row-flex" style={{ gap: 8 }}>
      {withDate ? (
        <time dateTime={iso} className="tabular">
          {formatDate(iso, locale)}
        </time>
      ) : null}
      <span className={`chip-deadline${d < 0 ? ' closed' : ''}`}>
        <Icon name="clock" size="sm" />
        {label}
      </span>
    </span>
  );
}

export function Pagination({
  prevHref,
  nextHref,
  label,
  dict,
}: {
  prevHref?: string | undefined;
  nextHref?: string | undefined;
  label: string;
  dict: Dictionary;
}) {
  if (!prevHref && !nextHref) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      {prevHref ? (
        <Link className="btn secondary sm" href={prevHref}>
          ← {dict.common.previous}
        </Link>
      ) : null}
      <span className="muted tabular">{label}</span>
      {nextHref ? (
        <Link className="btn secondary sm" href={nextHref}>
          {dict.common.next} →
        </Link>
      ) : null}
    </nav>
  );
}
