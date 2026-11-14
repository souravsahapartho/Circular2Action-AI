'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Icon } from '@/components/ui';
import type { Dictionary } from '@/i18n/dictionaries';
import { callApi, errorMessage, fieldErrors } from '@/lib/client-api';

type L = Dictionary['apply'];

export function CodeCard({
  code,
  id,
  locale,
  labels,
  title,
  text,
}: {
  code: string;
  id: string;
  locale: string;
  labels: L;
  title: string;
  text: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card success-card" aria-live="polite">
      <h2 style={{ marginTop: 0 }}>
        <Icon name="check" /> {title}
      </h2>
      <p className="muted">{text}</p>
      <p className="small muted" style={{ marginBottom: 4 }}>
        {labels.yourId}
      </p>
      <div className="code-box">
        <code className="tracking-code" data-testid="tracking-code">
          {code}
        </code>
        <button
          type="button"
          className="btn secondary sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // the clipboard can be blocked; the code stays selectable on the page
            }
          }}
        >
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
      <div className="row-flex" style={{ marginTop: 16 }}>
        <Link className="btn" href={`/${locale}/app/applications/${id}`}>
          {labels.viewApplication}
        </Link>
        <Link className="btn secondary" href={`/${locale}/track/${code}`}>
          {labels.trackPage}
        </Link>
      </div>
    </div>
  );
}

export function ApplyForm({
  opportunityId,
  locale,
  name,
  email,
  existing,
  labels,
  errors,
}: {
  opportunityId: string;
  locale: string;
  name: string;
  email: string;
  existing: { id: string; code: string } | null;
  labels: L;
  errors: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ id: string; code: string; existing: boolean } | null>(
    existing ? { ...existing, existing: true } : null,
  );

  if (done) {
    return (
      <CodeCard
        code={done.code}
        id={done.id}
        locale={locale}
        labels={labels}
        title={done.existing ? labels.already : labels.successTitle}
        text={labels.successText}
      />
    );
  }

  return (
    <form
      className="card stack"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setFields({});
        const f = new FormData(e.currentTarget);
        if (f.get('consent') !== 'on') {
          setFields({ consent: labels.consentRequired });
          return;
        }
        setBusy(true);
        const phone = String(f.get('phone') ?? '').trim();
        const note = String(f.get('note') ?? '').trim();
        const out = await callApi<{ id: string; tracking_code: string; existing: boolean }>(
          'POST',
          `/api/v1/opportunities/${opportunityId}/apply`,
          { consent: true, phone: phone || null, cover_note: note || null },
        );
        setBusy(false);
        if (out.ok && out.data) {
          setDone({ id: out.data.id, code: out.data.tracking_code, existing: out.data.existing });
        } else if (out.status === 422) {
          setFields(fieldErrors(out));
          setError(errorMessage(errors, out));
        } else if (out.status === 409) {
          setError(out.error?.message ?? errorMessage(errors, out));
        } else setError(errorMessage(errors, out));
      }}
    >
      <p className="muted" style={{ margin: 0 }}>
        {labels.intro}
      </p>
      <div className="summary-box">
        <strong>{name}</strong>
        <span className="muted small">{email}</span>
        <span className="muted small">
          {labels.profileHint} <Link href={`/${locale}/app/profile`}>{labels.editProfile}</Link>
        </span>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className={`field${fields.phone ? ' invalid' : ''}`}>
        <label htmlFor="ap-phone">{labels.phone}</label>
        <input
          id="ap-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          className="input"
          maxLength={30}
        />
        {fields.phone ? <span className="field-error">{fields.phone}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="ap-note">{labels.note}</label>
        <textarea id="ap-note" name="note" rows={5} maxLength={3000} className="input" />
      </div>
      <div className={`field${fields.consent ? ' invalid' : ''}`}>
        <label className="check">
          <input type="checkbox" name="consent" /> <span>{labels.consent}</span>
        </label>
        {fields.consent ? <span className="field-error">{fields.consent}</span> : null}
      </div>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
