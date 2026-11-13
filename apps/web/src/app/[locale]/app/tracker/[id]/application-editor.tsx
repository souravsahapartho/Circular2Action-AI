'use client';

import { useState } from 'react';
import { Alert, Icon } from '@/components/ui';
import { formatDate } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { callApi, errorMessage } from '@/lib/client-api';
import { STATUSES } from '../tracker-view';

export interface AppDetail {
  id: string;
  opportunity_id: string | null;
  title: string;
  organization: string | null;
  url: string | null;
  deadline_at: string | null;
  status: string;
  applied_at: string | null;
  exam_at: string | null;
  interview_at: string | null;
  follow_up_at: string | null;
  payment_status: string | null;
  amount_paid: number | null;
  notes: string | null;
  history: Array<{
    from_status: string | null;
    to_status: string;
    note: string | null;
    at: string;
  }>;
  checklist: Array<{ id: string; label: string; done: boolean; origin: string }>;
}

type L = Dictionary['tracker'];
const sl = (l: L, s: string) => (l as unknown as Record<string, string>)[`s_${s}`] ?? s;
const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

export function ApplicationEditor({
  initial,
  locale,
  labels,
  errors,
}: {
  initial: AppDetail;
  locale: 'bn' | 'en';
  labels: L;
  errors: Record<string, string>;
  explore: Dictionary['explore'];
}) {
  const [a, setA] = useState(initial);
  const [form, setForm] = useState({
    applied_at: initial.applied_at ?? '',
    exam_at: toLocalInput(initial.exam_at),
    interview_at: toLocalInput(initial.interview_at),
    follow_up_at: toLocalInput(initial.follow_up_at),
    payment_status: initial.payment_status ?? '',
    amount_paid: initial.amount_paid === null ? '' : String(initial.amount_paid),
    notes: initial.notes ?? '',
  });
  const [note, setNote] = useState('');
  const [newItem, setNewItem] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const out = await callApi<AppDetail>('GET', `/api/v1/me/applications/${a.id}`);
    if (out.ok && out.data) setA(out.data);
  }

  async function changeStatus(to: string) {
    setError(null);
    const out = await callApi('POST', `/api/v1/me/applications/${a.id}/status`, {
      to_status: to,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (out.ok) {
      setNote('');
      setMsg(labels.changed);
      void reload();
    } else setError(errorMessage(errors, out));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    const dt = (v: string) => (v ? `${v}T17:59:59.000Z` : null);
    const out = await callApi('PATCH', `/api/v1/me/applications/${a.id}`, {
      applied_at: form.applied_at || null,
      exam_at: dt(form.exam_at),
      interview_at: dt(form.interview_at),
      follow_up_at: dt(form.follow_up_at),
      payment_status: form.payment_status || null,
      amount_paid: form.amount_paid === '' ? null : Number(form.amount_paid),
      notes: form.notes || null,
    });
    setBusy(false);
    if (out.ok) {
      setMsg(labels.changed);
      void reload();
    } else setError(errorMessage(errors, out));
  }

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="detail" style={{ marginTop: 16 }}>
      <div className="stack">
        {msg ? <Alert kind="success">{msg}</Alert> : null}
        {error ? <Alert kind="error">{error}</Alert> : null}

        <form className="card" onSubmit={(e) => void save(e)}>
          <h2>{labels.saveChanges}</h2>
          <div className="form-grid two">
            <div className="field">
              <label htmlFor="a-applied">{labels.appliedAt}</label>
              <input
                id="a-applied"
                type="date"
                className="input"
                value={form.applied_at}
                onChange={(e) => set('applied_at', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="a-exam">{labels.exam}</label>
              <input
                id="a-exam"
                type="date"
                className="input"
                value={form.exam_at}
                onChange={(e) => set('exam_at', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="a-int">{labels.interview}</label>
              <input
                id="a-int"
                type="date"
                className="input"
                value={form.interview_at}
                onChange={(e) => set('interview_at', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="a-fu">{labels.followUp}</label>
              <input
                id="a-fu"
                type="date"
                className="input"
                value={form.follow_up_at}
                onChange={(e) => set('follow_up_at', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="a-pay">{labels.payment}</label>
              <select
                id="a-pay"
                className="input"
                value={form.payment_status}
                onChange={(e) => set('payment_status', e.target.value)}
              >
                <option value="" />
                <option value="not_required">{labels.pay_not_required}</option>
                <option value="unpaid">{labels.pay_unpaid}</option>
                <option value="paid">{labels.pay_paid}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-amt">{labels.amount}</label>
              <input
                id="a-amt"
                type="number"
                min="0"
                step="1"
                className="input"
                value={form.amount_paid}
                onChange={(e) => set('amount_paid', e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="a-notes">{labels.notes}</label>
            <textarea
              id="a-notes"
              className="input"
              maxLength={5000}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {labels.saveChanges}
          </button>
        </form>

        <section className="card">
          <h2>{labels.checklist}</h2>
          {a.checklist.length === 0 ? null : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
              {a.checklist.map((c) => (
                <li
                  key={c.id}
                  className="rule-row"
                  style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}
                >
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={c.done}
                      onChange={async (e) => {
                        await callApi(
                          'PATCH',
                          `/api/v1/me/applications/${a.id}/checklist/${c.id}`,
                          { done: e.target.checked },
                        );
                        void reload();
                      }}
                    />
                    <span style={{ textDecoration: c.done ? 'line-through' : 'none' }}>
                      {c.label}
                    </span>
                  </label>
                  <button
                    className="btn ghost sm"
                    type="button"
                    aria-label="Remove"
                    onClick={async () => {
                      await callApi('DELETE', `/api/v1/me/applications/${a.id}/checklist/${c.id}`);
                      void reload();
                    }}
                  >
                    <Icon name="trash" size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="row-flex"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newItem.trim()) return;
              const out = await callApi('POST', `/api/v1/me/applications/${a.id}/checklist`, {
                label: newItem.trim(),
              });
              if (out.ok) {
                setNewItem('');
                void reload();
              }
            }}
          >
            <input
              className="input"
              style={{ flex: 1 }}
              value={newItem}
              maxLength={300}
              placeholder={labels.addItem}
              aria-label={labels.addItem}
              onChange={(e) => setNewItem(e.target.value)}
            />
            <button className="btn secondary" type="submit">
              <Icon name="plus" size="sm" /> {labels.add}
            </button>
          </form>
        </section>
      </div>

      <aside className="stack">
        <div className="card">
          <h2>{labels.status}</h2>
          <div className="field">
            <label htmlFor="a-status" className="sr-only">
              {labels.status}
            </label>
            <select
              id="a-status"
              className="input"
              value={a.status}
              onChange={(e) => void changeStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {sl(labels, s)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="a-note">{labels.note}</label>
            <input
              id="a-note"
              className="input"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="card">
          <h2>{labels.timeline}</h2>
          <ol className="timeline">
            {[...a.history].reverse().map((h, i) => (
              <li key={i}>
                <strong>{sl(labels, h.to_status)}</strong>
                <div className="muted small tabular">{formatDate(h.at, locale)}</div>
                {h.note ? <div className="small">{h.note}</div> : null}
              </li>
            ))}
          </ol>
        </div>

        <button
          className="btn danger"
          type="button"
          onClick={async () => {
            if (!window.confirm(labels.confirmDelete)) return;
            const out = await callApi('DELETE', `/api/v1/me/applications/${a.id}`);
            if (out.ok) window.location.assign(`/${locale}/app/tracker`);
          }}
        >
          <Icon name="trash" /> {labels.deleteApp}
        </button>
      </aside>
    </div>
  );
}
