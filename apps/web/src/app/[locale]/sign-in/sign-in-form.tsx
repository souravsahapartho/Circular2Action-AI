'use client';

import { useState } from 'react';

interface Labels {
  email: string;
  password: string;
  submit: string;
  failed: string;
  unavailable: string;
}

/** Posts to the API through the same-origin /api rewrite so the session cookie stays first-party (gate S-5). */
export function SignInForm({ labels }: { labels: Labels }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      // Pre-session CSRF (plan 9.9): fetch a signed token, which also sets the cookie, then echo it in a header.
      const csrfRes = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
      if (!csrfRes.ok) throw new Error('csrf');
      const { data } = (await csrfRes.json()) as { data: { csrf_token: string } };
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': data.csrf_token },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
        credentials: 'same-origin',
      });
      if (res.ok) {
        window.location.assign('./app/profile');
        return;
      }
      setError(res.status === 401 || res.status === 400 ? labels.failed : labels.unavailable);
    } catch {
      setError(labels.unavailable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ maxWidth: 420 }} noValidate>
      {error ? (
        <p role="alert" className="state" style={{ padding: 12, marginBottom: 16 }}>
          {error}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="email">{labels.email}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
        />
      </div>
      <div className="field">
        <label htmlFor="password">{labels.password}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>
      <button className="btn" type="submit" disabled={busy} aria-busy={busy}>
        {labels.submit}
      </button>
    </form>
  );
}
