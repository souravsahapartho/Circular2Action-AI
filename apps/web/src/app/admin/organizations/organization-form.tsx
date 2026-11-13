'use client';

import { useState } from 'react';
import { Alert, Icon } from '@/components/ui';
import { callApi, fieldErrors } from '@/lib/client-api';

const TYPES = [
  'government',
  'autonomous',
  'bank',
  'private',
  'ngo',
  'university',
  'international',
  'other',
];

export function OrganizationForm() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMsg(null);
    setFe({});
    const f = new FormData(form);
    const out = await callApi('POST', '/api/v1/admin/organizations', {
      name_en: String(f.get('name_en') ?? '').trim() || null,
      name_bn: String(f.get('name_bn') ?? '').trim() || null,
      type: String(f.get('type')),
      website_url: String(f.get('website') ?? '').trim() || null,
    });
    setBusy(false);
    if (out.ok) {
      form.reset();
      setMsg({ ok: true, text: 'Organisation created.' });
      window.setTimeout(() => window.location.reload(), 600);
    } else {
      setFe(fieldErrors(out));
      setMsg({
        ok: false,
        text:
          out.error?.code === 'ALREADY_EXISTS'
            ? 'An organisation with this name already exists.'
            : (out.error?.message ?? 'Could not create it.'),
      });
    }
  }
  return (
    <form className="card" onSubmit={(e) => void submit(e)} noValidate>
      <h2>Add an organisation</h2>
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
      <div className="form-grid two">
        <div className="field">
          <label htmlFor="name_en">Name in English</label>
          <input id="name_en" name="name_en" className="input" maxLength={250} />
        </div>
        <div className="field">
          <label htmlFor="name_bn">Name in Bangla</label>
          <input id="name_bn" name="name_bn" lang="bn" className="input" maxLength={250} />
        </div>
        <div className="field">
          <label htmlFor="type">Type</label>
          <select id="type" name="type" className="input" defaultValue="government">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className={`field${fe.website_url ? ' invalid' : ''}`}>
          <label htmlFor="website">Website (optional)</label>
          <input id="website" name="website" type="url" className="input" placeholder="https://" />
          {fe.website_url ? <span className="field-error">{fe.website_url}</span> : null}
        </div>
      </div>
      <button className="btn" type="submit" disabled={busy}>
        <Icon name="plus" size="sm" /> Add organisation
      </button>
    </form>
  );
}
