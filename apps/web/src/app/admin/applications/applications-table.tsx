'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

export interface AppRow {
  id: string;
  tracking_code: string;
  status: string;
  submitted_at: string;
  applicant_name: string;
  applicant_email: string;
  eligibility_status: string | null;
  opportunity: { id: string; title: string; organization: string };
}

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  accepted: 'Accepted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};
const ELIG: Record<string, string> = {
  eligible: 'Eligible',
  not_eligible: 'Not eligible',
  needs_verification: 'Needs verification',
  insufficient_information: 'Insufficient information',
};
const MOVES = ['under_review', 'shortlisted', 'interview', 'accepted', 'rejected'];

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));

/** The applications list with row selection and a bulk "move to" bar (staff with the manage permission). */
export function ApplicationsTable({ rows, canManage }: { rows: AppRow[]; canManage: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('under_review');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const all = rows.length > 0 && picked.size === rows.length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function apply() {
    setBusy(true);
    setMsg(null);
    const out = await callApi<{ updated: number; skipped: Array<{ id: string; reason: string }> }>(
      'POST',
      '/api/v1/admin/applications/bulk-status',
      { ids: [...picked], status: to, note: note.trim() || null, visible_to_applicant: true },
    );
    setBusy(false);
    if (out.ok && out.data) {
      const s = out.data.skipped.length;
      setMsg({
        ok: s === 0,
        text: `${out.data.updated} moved to “${STATUS_LABEL[to]}”${s ? `, ${s} skipped (already closed or not allowed from their current step)` : ''}.`,
      });
      setPicked(new Set());
      setNote('');
      router.refresh();
    } else setMsg({ ok: false, text: out.error?.message ?? 'Could not update the applications.' });
  }

  return (
    <>
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
      {canManage && picked.size > 0 ? (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <strong>{picked.size} selected</strong>
          <label className="sr-only" htmlFor="bulk-to">
            Move to
          </label>
          <select id="bulk-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {MOVES.map((m) => (
              <option key={m} value={m}>
                Move to: {STATUS_LABEL[m]}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="bulk-note">
            Note shown to applicants
          </label>
          <input
            id="bulk-note"
            className="input"
            placeholder="Note for the applicants (optional)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn" type="button" disabled={busy} onClick={() => void apply()}>
            {busy ? 'Working…' : 'Apply'}
          </button>
          <button className="btn ghost" type="button" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {canManage ? (
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={all}
                    onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              ) : null}
              <th>Tracking ID</th>
              <th>Applicant</th>
              <th>Opportunity</th>
              <th>Eligibility</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={picked.has(a.id) ? 'picked' : undefined}>
                {canManage ? (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.tracking_code}`}
                      checked={picked.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                  </td>
                ) : null}
                <td>
                  <Link href={`/admin/applications/${a.id}`}>
                    <code>{a.tracking_code}</code>
                  </Link>
                </td>
                <td>
                  {a.applicant_name}
                  <br />
                  <span className="muted small">{a.applicant_email}</span>
                </td>
                <td>
                  {a.opportunity.title}
                  <br />
                  <span className="muted small">{a.opportunity.organization}</span>
                </td>
                <td className="small">
                  {a.eligibility_status
                    ? (ELIG[a.eligibility_status] ?? a.eligibility_status)
                    : '–'}
                </td>
                <td>
                  <span className={`pill pill-${a.status}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </td>
                <td className="small">{fmt(a.submitted_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
