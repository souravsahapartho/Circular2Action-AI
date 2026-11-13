'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Badge, Icon } from '@/components/ui';
import type { Dictionary } from '@/i18n/dictionaries';
import { daysUntil, formatDate } from '@/i18n/config';
import { callApi, errorMessage, fieldErrors } from '@/lib/client-api';

export interface AppRow {
  id: string;
  opportunity_id: string | null;
  title: string;
  organization: string | null;
  deadline_at: string | null;
  status: string;
}

export const STATUSES = [
  'interested',
  'preparing',
  'ready_to_apply',
  'applied',
  'exam_scheduled',
  'interview',
  'selected',
  'rejected',
  'withdrawn',
] as const;

type L = Dictionary['tracker'];
const label = (l: L, s: string) => (l as unknown as Record<string, string>)[`s_${s}`] ?? s;

function Deadline({
  iso,
  locale,
  now,
  explore,
}: {
  iso: string;
  locale: 'bn' | 'en';
  now: Date;
  explore: Dictionary['explore'];
}) {
  const n = daysUntil(iso, now);
  const nf = new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB');
  return (
    <span className="small">
      <time dateTime={iso} className="tabular">
        {formatDate(iso, locale)}
      </time>{' '}
      <span className={`chip-deadline${n < 0 ? ' closed' : ''}`}>
        {n < 0
          ? explore.closed
          : n === 0
            ? explore.today
            : explore.daysLeft.replace('{n}', nf.format(n))}
      </span>
    </span>
  );
}

export function TrackerView({
  initial,
  locale,
  labels,
  errors,
  explore,
  common,
}: {
  initial: AppRow[];
  locale: 'bn' | 'en';
  labels: L;
  errors: Record<string, string>;
  explore: Dictionary['explore'];
  common: Dictionary['common'];
}) {
  const [rows, setRows] = useState(initial);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  async function reload() {
    const out = await callApi<AppRow[]>('GET', '/api/v1/me/applications');
    if (out.ok && out.data) setRows(out.data);
  }
  async function changeStatus(id: string, to: string) {
    setError(null);
    const prev = rows;
    setRows(rows.map((r) => (r.id === id ? { ...r, status: to } : r)));
    const out = await callApi('POST', `/api/v1/me/applications/${id}/status`, { to_status: to });
    if (!out.ok) {
      setRows(prev);
      setError(errorMessage(errors, out));
    }
  }

  const StatusSelect = ({ r }: { r: AppRow }) => (
    <select
      className="input"
      style={{ minHeight: 36, padding: '4px 8px', width: 'auto' }}
      value={r.status}
      aria-label={labels.status}
      onChange={(e) => void changeStatus(r.id, e.target.value)}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {label(labels, s)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="stack">
      <div className="row-flex" style={{ justifyContent: 'space-between' }}>
        <div className="seg" role="group" aria-label={labels.list + ' / ' + labels.board}>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <Icon name="list" size="sm" /> {labels.list}
          </button>
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>
            <Icon name="dashboard" size="sm" /> {labels.board}
          </button>
        </div>
        <button
          className="btn"
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
        >
          <Icon name="plus" /> {labels.addManual}
        </button>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {adding ? (
        <ManualForm
          labels={labels}
          errors={errors}
          onDone={() => {
            setAdding(false);
            void reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {rows.length === 0 ? (
        <section className="state">
          <Icon name="list" />
          <h2>{labels.empty}</h2>
          <p className="muted">{labels.emptyText}</p>
          <Link className="btn" href={`/${locale}/opportunities`}>
            {explore.title}
          </Link>
        </section>
      ) : view === 'list' ? (
        <ul className="opp-list">
          {rows.map((r) => (
            <li key={r.id} className="opp">
              <div>
                <h3>
                  <Link href={`/${locale}/app/tracker/${r.id}`}>{r.title}</Link>
                </h3>
                <div className="meta">
                  {r.organization ? <span>{r.organization}</span> : null}
                  {r.deadline_at ? (
                    <Deadline iso={r.deadline_at} locale={locale} now={now} explore={explore} />
                  ) : null}
                </div>
              </div>
              <div className="side">
                <StatusSelect r={r} />
                <Link className="btn ghost sm" href={`/${locale}/app/tracker/${r.id}`}>
                  {labels.open} <Icon name="arrow" size="sm" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="board">
          {STATUSES.map((s) => {
            const col = rows.filter((r) => r.status === s);
            return (
              <section key={s} className="board-col" aria-label={label(labels, s)}>
                <h3>
                  <span>{label(labels, s)}</span>
                  <Badge tone="neutral">{col.length}</Badge>
                </h3>
                {col.map((r) => (
                  <div key={r.id} className="board-card">
                    <Link href={`/${locale}/app/tracker/${r.id}`}>{r.title}</Link>
                    {r.organization ? <div className="muted small">{r.organization}</div> : null}
                    {r.deadline_at ? (
                      <Deadline iso={r.deadline_at} locale={locale} now={now} explore={explore} />
                    ) : null}
                    <div style={{ marginTop: 6 }}>
                      <StatusSelect r={r} />
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      <span className="sr-only">{common.loading}</span>
    </div>
  );
}

function ManualForm({
  labels,
  errors,
  onDone,
  onCancel,
}: {
  labels: L;
  errors: Record<string, string>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    const f = new FormData(e.currentTarget);
    const deadline = String(f.get('deadline') ?? '');
    const out = await callApi('POST', '/api/v1/me/applications', {
      title: String(f.get('title') ?? '').trim(),
      ...(String(f.get('org') ?? '').trim() ? { organization: String(f.get('org')).trim() } : {}),
      ...(String(f.get('url') ?? '').trim() ? { url: String(f.get('url')).trim() } : {}),
      ...(deadline ? { deadline_at: `${deadline}T17:59:59.000Z` } : {}),
    });
    setBusy(false);
    if (out.ok) onDone();
    else {
      setFe(fieldErrors(out));
      setError(errorMessage(errors, out));
    }
  }
  return (
    <form className="card" onSubmit={(e) => void submit(e)} noValidate>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="form-grid two">
        <div className={`field${fe.title ? ' invalid' : ''}`}>
          <label htmlFor="m-title">{labels.titleField}</label>
          <input id="m-title" name="title" className="input" required maxLength={300} />
        </div>
        <div className="field">
          <label htmlFor="m-org">{labels.org}</label>
          <input id="m-org" name="org" className="input" maxLength={250} />
        </div>
        <div className={`field${fe.url ? ' invalid' : ''}`}>
          <label htmlFor="m-url">{labels.url}</label>
          <input id="m-url" name="url" type="url" className="input" placeholder="https://" />
          {fe.url ? <span className="field-error">{fe.url}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="m-dl">{labels.deadline}</label>
          <input id="m-dl" name="deadline" type="date" className="input" />
        </div>
      </div>
      <div className="row-flex">
        <button className="btn" type="submit" disabled={busy}>
          {labels.add}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>
          ✕
        </button>
      </div>
    </form>
  );
}
