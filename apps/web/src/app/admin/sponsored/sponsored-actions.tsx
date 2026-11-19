'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

/** Approve or decline one pending sponsorship request. */
export function SponsoredActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    const note =
      decision === 'reject' ? window.prompt('Reason (shown to the employer, optional):') : null;
    if (decision === 'reject' && note === null) return;
    setBusy(true);
    setError(null);
    const out = await callApi('POST', `/api/v1/admin/sponsorships/${id}/decision`, {
      decision,
      ...(note ? { note: note.trim().slice(0, 300) } : {}),
    });
    setBusy(false);
    if (out.ok) router.refresh();
    else setError(out.error?.message ?? 'Could not save.');
  }

  return (
    <div className="row-flex" style={{ gap: 6 }}>
      <button
        type="button"
        className="btn sm"
        disabled={busy}
        onClick={() => void decide('approve')}
      >
        Approve
      </button>
      <button
        type="button"
        className="btn secondary sm"
        disabled={busy}
        onClick={() => void decide('reject')}
      >
        Decline
      </button>
      {error ? (
        <span className="small" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Staff start a demo sponsorship on a published opportunity. */
export function StartDemo() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="row-flex"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const out = await callApi('POST', `/api/v1/admin/opportunities/${id.trim()}/sponsor`, {
          days,
        });
        setBusy(false);
        if (out.ok) {
          setMsg({ ok: true, text: 'Sponsorship started.' });
          setId('');
          router.refresh();
        } else {
          setMsg({ ok: false, text: out.error?.message ?? 'Could not start it.' });
        }
      }}
    >
      <label htmlFor="sp-id" className="sr-only">
        Opportunity ID
      </label>
      <input
        id="sp-id"
        className="input"
        style={{ maxWidth: 240 }}
        inputMode="numeric"
        pattern="\d{1,20}"
        required
        placeholder="Opportunity ID"
        value={id}
        onChange={(e) => setId(e.target.value)}
      />
      <label htmlFor="sp-days" className="sr-only">
        Days
      </label>
      <select
        id="sp-days"
        className="input"
        style={{ maxWidth: 140 }}
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
      >
        {[3, 7, 14].map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </select>
      <button className="btn" type="submit" disabled={busy}>
        Start
      </button>
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
    </form>
  );
}
