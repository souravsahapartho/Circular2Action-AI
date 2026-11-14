'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi, fieldErrors } from '@/lib/client-api';

export interface Company {
  company_name: string;
  website: string | null;
  phone: string | null;
  verification_status: string;
}

export function CompanyForm({ initial }: { initial: Company }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  return (
    <form
      className="stack"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        setFe({});
        const f = new FormData(e.currentTarget);
        const website = String(f.get('website') ?? '').trim();
        const phone = String(f.get('phone') ?? '').trim();
        const out = await callApi('PUT', '/api/v1/employer/profile', {
          company_name: String(f.get('name') ?? '').trim(),
          website: website || null,
          phone: phone || null,
        });
        setBusy(false);
        if (out.ok) setMsg({ ok: true, text: 'Saved.' });
        else {
          setFe(fieldErrors(out));
          setMsg({ ok: false, text: out.error?.message ?? 'Could not save.' });
        }
      }}
    >
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
      <div className={`field${fe.company_name ? ' invalid' : ''}`}>
        <label htmlFor="c-name">Company or organisation name</label>
        <input
          id="c-name"
          name="name"
          className="input"
          defaultValue={initial.company_name}
          required
          maxLength={200}
        />
        {fe.company_name ? <span className="field-error">{fe.company_name}</span> : null}
      </div>
      <div className={`field${fe.website ? ' invalid' : ''}`}>
        <label htmlFor="c-web">Website</label>
        <input
          id="c-web"
          name="website"
          type="url"
          className="input"
          placeholder="https://"
          defaultValue={initial.website ?? ''}
        />
        {fe.website ? <span className="field-error">{fe.website}</span> : null}
      </div>
      <div className={`field${fe.phone ? ' invalid' : ''}`}>
        <label htmlFor="c-phone">Contact phone</label>
        <input
          id="c-phone"
          name="phone"
          type="tel"
          className="input"
          defaultValue={initial.phone ?? ''}
        />
        {fe.phone ? <span className="field-error">{fe.phone}</span> : null}
      </div>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
