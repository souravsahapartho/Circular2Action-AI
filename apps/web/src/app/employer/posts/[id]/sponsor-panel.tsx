'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge } from '@/components/ui';
import { callApi } from '@/lib/client-api';

export interface Sponsorship {
  id: string;
  status: 'pending' | 'active' | 'rejected' | 'ended';
  days: number;
  ends_at: string | null;
  note: string | null;
  impressions: number;
  clicks: number;
}

const TONE = { pending: 'warn', active: 'success', rejected: 'danger', ended: 'neutral' } as const;
const LABEL = {
  pending: 'Waiting for approval',
  active: 'Running',
  rejected: 'Declined',
  ended: 'Ended',
} as const;

/** Promote a live post: staff approve it, then it is shown (labelled "Sponsored") to the people it fits. */
export function SponsorPanel({
  opportunityId,
  items,
}: {
  opportunityId: string;
  items: Sponsorship[];
}) {
  const router = useRouter();
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const open = items.find((s) => s.status === 'pending' || s.status === 'active');

  async function request() {
    setBusy(true);
    setMsg(null);
    const out = await callApi('POST', `/api/v1/employer/opportunities/${opportunityId}/sponsor`, {
      days,
    });
    setBusy(false);
    if (out.ok) {
      setMsg({ ok: true, text: 'Request sent. Staff will review it shortly.' });
      router.refresh();
    } else {
      setMsg({ ok: false, text: out.error?.message ?? 'Could not send the request.' });
    }
  }

  async function end(id: string) {
    if (!window.confirm('Stop this sponsorship now?')) return;
    setBusy(true);
    const out = await callApi('POST', `/api/v1/employer/sponsorships/${id}/end`, {});
    setBusy(false);
    if (out.ok) router.refresh();
    else setMsg({ ok: false, text: out.error?.message ?? 'Could not stop it.' });
  }

  return (
    <section className="panel" style={{ marginTop: 16 }} aria-labelledby="sponsor-title">
      <h2 id="sponsor-title">Promote this post</h2>
      <p className="muted" style={{ maxWidth: '70ch' }}>
        Need people urgently? A sponsored post is shown first to the people whose interests fit it,
        marked &quot;Sponsored&quot;. This is the <strong>demo plan</strong>: it is free for now and
        staff approve each request.
      </p>
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
      {open ? null : (
        <div className="row-flex">
          <label htmlFor="sp-days" className="sr-only">
            Duration
          </label>
          <select
            id="sp-days"
            className="input"
            style={{ maxWidth: 160 }}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[3, 7, 14].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={busy} onClick={() => void request()}>
            Request sponsorship
          </button>
        </div>
      )}
      {items.length > 0 ? (
        <ul className="sent-list" style={{ marginTop: 12 }}>
          {items.map((s) => (
            <li key={s.id}>
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <span>
                  <Badge tone={TONE[s.status]}>{LABEL[s.status]}</Badge> · {s.days} days
                  {s.ends_at ? ` · until ${s.ends_at.slice(0, 10)}` : ''}
                </span>
                {s.status === 'pending' || s.status === 'active' ? (
                  <button
                    type="button"
                    className="btn secondary sm"
                    disabled={busy}
                    onClick={() => void end(s.id)}
                  >
                    {s.status === 'pending' ? 'Cancel request' : 'Stop'}
                  </button>
                ) : null}
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {s.impressions} views · {s.clicks} clicks{s.note ? ` · ${s.note}` : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
