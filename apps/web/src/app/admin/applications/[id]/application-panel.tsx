'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

const LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  accepted: 'Accepted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};

/** Same rules as the API (it enforces them): staff move an application forward, never out of a closed state. */
const NEXT: Record<string, string[]> = {
  submitted: ['under_review', 'shortlisted', 'rejected'],
  under_review: ['shortlisted', 'interview', 'accepted', 'rejected'],
  shortlisted: ['interview', 'accepted', 'rejected'],
  interview: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));

interface Event {
  id: string;
  to_status: string;
  note: string | null;
  at: string;
  by_staff?: boolean;
  public?: boolean;
}

export function ApplicationPanel({
  id,
  status,
  adminNote,
  canManage,
  timeline,
}: {
  id: string;
  status: string;
  adminNote: string | null;
  canManage: boolean;
  timeline: Event[];
}) {
  const router = useRouter();
  const options = NEXT[status] ?? [];
  const [to, setTo] = useState(options[0] ?? '');
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const [internal, setInternal] = useState(adminNote ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function move() {
    setBusy(true);
    setMsg(null);
    const out = await callApi('POST', `/api/v1/admin/applications/${id}/status`, {
      status: to,
      note: note.trim() || null,
      visible_to_applicant: visible,
    });
    setBusy(false);
    if (out.ok) {
      setNote('');
      setMsg({ ok: true, text: `Moved to "${LABEL[to]}". The applicant sees it now.` });
      router.refresh();
    } else setMsg({ ok: false, text: out.error?.message ?? 'Could not update the status.' });
  }

  async function saveNote() {
    setBusy(true);
    setMsg(null);
    const out = await callApi('PUT', `/api/v1/admin/applications/${id}/note`, {
      note: internal.trim() || null,
    });
    setBusy(false);
    setMsg(
      out.ok
        ? { ok: true, text: 'Internal note saved.' }
        : { ok: false, text: out.error?.message ?? 'Could not save the note.' },
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Status</h2>
          <span className={`pill pill-${status}`}>{LABEL[status] ?? status}</span>
        </div>
        {msg ? (
          <div style={{ marginTop: 12 }}>
            <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>
          </div>
        ) : null}
        {canManage && options.length > 0 ? (
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="st-to">Move to</label>
              <select
                id="st-to"
                className="input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o} value={o}>
                    {LABEL[o]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="st-note">Note (optional)</label>
              <textarea
                id="st-note"
                className="input"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />{' '}
              <span>Show this step and note to the applicant</span>
            </label>
            <button
              type="button"
              className="btn"
              disabled={busy || !to}
              onClick={() => void move()}
            >
              Update status
            </button>
          </div>
        ) : (
          <p className="muted small" style={{ margin: '12px 0 0' }}>
            {options.length === 0
              ? 'This application is closed. Its status cannot change.'
              : 'You can view this application but not change it.'}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Internal note</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Never shown to the applicant.
        </p>
        <textarea
          className="input"
          rows={4}
          maxLength={3000}
          value={internal}
          onChange={(e) => setInternal(e.target.value)}
          disabled={!canManage}
          aria-label="Internal note"
        />
        {canManage ? (
          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={() => void saveNote()}
          >
            Save note
          </button>
        ) : null}
      </section>

      <section className="panel">
        <h2>Timeline</h2>
        <ol className="timeline">
          {timeline.map((e, i) => (
            <li key={e.id} className={i === timeline.length - 1 ? 'current' : undefined}>
              <span className="dot" aria-hidden="true" />
              <div>
                <strong>{LABEL[e.to_status] ?? e.to_status}</strong>
                <span className="muted small"> · {fmt(e.at)}</span>
                {e.by_staff ? (
                  <span
                    className={`badge ${e.public ? 'info' : 'neutral'}`}
                    style={{ marginLeft: 8 }}
                  >
                    {e.public ? 'visible to applicant' : 'private'}
                  </span>
                ) : null}
                {e.note ? <p className="muted small timeline-note">{e.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
