'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

export function StaffLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const f = new FormData(e.currentTarget);
        const out = await callApi<{ mfa_required?: boolean }>('POST', '/api/v1/auth/login', {
          email: f.get('email'),
          password: f.get('password'),
        });
        if (!out.ok) {
          setError(
            out.error?.code === 'INVALID_CREDENTIALS'
              ? 'Email or password is incorrect.'
              : out.error?.code === 'RATE_LIMITED'
                ? 'Too many attempts. Wait a few minutes and try again.'
                : 'Could not sign in. Try again in a moment.',
          );
          setBusy(false);
          return;
        }
        const me = await callApi<{ staff: boolean }>('GET', '/api/v1/me');
        if (!me.ok || !me.data?.staff) {
          // a public account is not staff: end the session that was just opened
          await callApi('POST', '/api/v1/auth/logout');
          setError('This account is not a staff account. Use the public site to sign in.');
          setBusy(false);
          return;
        }
        window.location.assign(out.data?.mfa_required ? '/admin/mfa' : '/admin');
      }}
    >
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="field">
        <label htmlFor="pl-email">Email</label>
        <input
          id="pl-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          className="input"
        />
      </div>
      <div className="field">
        <label htmlFor="pl-password">Password</label>
        <input
          id="pl-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>
      <button className="btn block" type="submit" disabled={busy} aria-busy={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
