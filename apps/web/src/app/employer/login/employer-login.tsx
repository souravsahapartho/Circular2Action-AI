'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

export function EmployerLogin() {
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
        if (out.data?.mfa_required) {
          window.location.assign('/admin/mfa'); // a staff account signed in here: send it to the staff flow
          return;
        }
        const me = await callApi<{ employer?: boolean }>('GET', '/api/v1/me');
        if (!me.ok || !me.data?.employer) {
          await callApi('POST', '/api/v1/auth/logout');
          setError(
            'This is not an employer account. Create one as an employer, or sign in on the public site.',
          );
          setBusy(false);
          return;
        }
        window.location.assign('/employer');
      }}
    >
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="field">
        <label htmlFor="el-email">Email</label>
        <input
          id="el-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          className="input"
        />
      </div>
      <div className="field">
        <label htmlFor="el-password">Password</label>
        <input
          id="el-password"
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
