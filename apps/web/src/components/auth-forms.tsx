'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import { callApi, errorMessage, fieldErrors, type ApiOutcome } from '@/lib/client-api';
import { safeNext } from '@/lib/safe-next';
import { Alert } from './ui';

type A = Dictionary['auth'];

export { safeNext };

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  return { busy, setBusy, error, setError, fields, setFields };
}

export function SignInForm({
  locale,
  next,
  labels,
  errors,
}: {
  locale: string;
  next: string | null;
  labels: A;
  errors: Record<string, string>;
}) {
  const s = useSubmit();
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    s.setBusy(true);
    s.setError(null);
    const f = new FormData(e.currentTarget);
    const out = await callApi<{ mfa_required?: boolean }>('POST', '/api/v1/auth/login', {
      email: f.get('email'),
      password: f.get('password'),
    });
    if (out.ok) {
      if (out.data?.mfa_required) window.location.assign('/admin/mfa');
      else window.location.assign(safeNext(next, `/${locale}/app`));
      return;
    }
    s.setError(
      out.error?.code === 'INVALID_CREDENTIALS' ? labels.failed : errorMessage(errors, out),
    );
    s.setBusy(false);
  }
  return (
    <form onSubmit={onSubmit} noValidate>
      {s.error ? <Alert kind="error">{s.error}</Alert> : null}
      <div className="field">
        <label htmlFor="email">{labels.email}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
          autoFocus
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
      <button className="btn block" type="submit" disabled={s.busy} aria-busy={s.busy}>
        {labels.submit}
      </button>
    </form>
  );
}

export function RegisterForm({
  locale,
  labels,
  errors,
}: {
  locale: string;
  labels: A;
  errors: Record<string, string>;
}) {
  const s = useSubmit();
  const [done, setDone] = useState<null | 'ready' | 'verify'>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    s.setBusy(true);
    s.setError(null);
    s.setFields({});
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    const local: Record<string, string> = {};
    if (!email.includes('@')) local.email = errors.VALIDATION_ERROR ?? '';
    if (
      [...password].length < 8 ||
      !/\p{Ll}/u.test(password) ||
      !/\p{Lu}/u.test(password) ||
      !/[^\p{L}\p{N}\s]/u.test(password)
    )
      local.password = labels.passwordHint;
    if (Object.keys(local).length) {
      s.setFields(local);
      s.setBusy(false);
      return;
    }
    const out = await callApi<{ email_verification_required: boolean }>(
      'POST',
      '/api/v1/auth/register',
      {
        email,
        password,
        display_name: String(f.get('name') ?? '').trim(),
        age_confirmed: f.get('age') === 'on',
        locale,
        consents: {
          terms: f.get('terms') === 'on',
          privacy: f.get('terms') === 'on',
          weekly_digest: f.get('digest') === 'on',
        },
      },
    );
    if (!out.ok) {
      s.setFields(fieldErrors(out));
      s.setError(errorMessage(errors, out));
      s.setBusy(false);
      return;
    }
    if (out.data?.email_verification_required === false) {
      // staging without an email provider: the account is ready, so sign in straight away
      const login = await callApi('POST', '/api/v1/auth/login', { email, password });
      if (login.ok) {
        window.location.assign(`/${locale}/app/profile`);
        return;
      }
      setDone('ready');
    } else {
      setDone('verify');
    }
    s.setBusy(false);
  }
  if (done) {
    return (
      <div className="stack">
        <Alert kind="success">
          {done === 'ready' ? labels.registerDoneReady : labels.registerDoneVerify}
        </Alert>
        <Link className="btn block" href={`/${locale}/sign-in`}>
          {labels.signInTitle}
        </Link>
      </div>
    );
  }
  const fe = s.fields;
  return (
    <form onSubmit={onSubmit} noValidate>
      {s.error ? <Alert kind="error">{s.error}</Alert> : null}
      <div className={`field${fe.display_name ? ' invalid' : ''}`}>
        <label htmlFor="name">{labels.name}</label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          className="input"
        />
        {fe.display_name ? <span className="field-error">{fe.display_name}</span> : null}
      </div>
      <div className={`field${fe.email ? ' invalid' : ''}`}>
        <label htmlFor="email">{labels.email}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
        />
        {fe.email ? <span className="field-error">{fe.email}</span> : null}
      </div>
      <div className={`field${fe.password ? ' invalid' : ''}`}>
        <label htmlFor="password">{labels.password}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input"
          aria-describedby="pw-hint"
        />
        <span id="pw-hint" className={fe.password ? 'field-error' : 'hint'}>
          {fe.password ?? labels.passwordHint}
        </span>
      </div>
      <div className="stack" style={{ marginBottom: 16 }}>
        <label className="check">
          <input type="checkbox" name="age" required /> <span>{labels.age}</span>
        </label>
        <label className="check">
          <input type="checkbox" name="terms" required /> <span>{labels.terms}</span>
        </label>
        <label className="check">
          <input type="checkbox" name="digest" /> <span>{labels.digest}</span>
        </label>
      </div>
      <button className="btn block" type="submit" disabled={s.busy} aria-busy={s.busy}>
        {labels.registerSubmit}
      </button>
    </form>
  );
}

export function ForgotForm({ labels, errors }: { labels: A; errors: Record<string, string> }) {
  const s = useSubmit();
  const [sent, setSent] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    s.setBusy(true);
    s.setError(null);
    const out = await callApi('POST', '/api/v1/auth/password/forgot', {
      email: String(new FormData(e.currentTarget).get('email') ?? '').trim(),
    });
    s.setBusy(false);
    if (out.ok) setSent(true);
    else s.setError(errorMessage(errors, out));
  }
  if (sent) return <Alert kind="success">{labels.forgotSent}</Alert>;
  return (
    <form onSubmit={onSubmit} noValidate>
      {s.error ? <Alert kind="error">{s.error}</Alert> : null}
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
      <button className="btn block" type="submit" disabled={s.busy}>
        {labels.forgotSubmit}
      </button>
    </form>
  );
}

export function ResetForm({
  locale,
  token,
  labels,
  errors,
}: {
  locale: string;
  token: string;
  labels: A;
  errors: Record<string, string>;
}) {
  const s = useSubmit();
  const [done, setDone] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    s.setBusy(true);
    s.setError(null);
    const out: ApiOutcome<unknown> = await callApi('POST', '/api/v1/auth/password/reset', {
      token,
      new_password: String(new FormData(e.currentTarget).get('password') ?? ''),
    });
    s.setBusy(false);
    if (out.ok) setDone(true);
    else s.setError(errorMessage(errors, out));
  }
  if (done) {
    return (
      <div className="stack">
        <Alert kind="success">{labels.resetDone}</Alert>
        <Link className="btn block" href={`/${locale}/sign-in`}>
          {labels.signInTitle}
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate>
      {s.error ? <Alert kind="error">{s.error}</Alert> : null}
      <div className="field">
        <label htmlFor="password">{labels.newPassword}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input"
        />
        <span className="hint">{labels.passwordHint}</span>
      </div>
      <button className="btn block" type="submit" disabled={s.busy}>
        {labels.resetSubmit}
      </button>
    </form>
  );
}

export function VerifyEmail({
  locale,
  token,
  labels,
  errors,
}: {
  locale: string;
  token: string;
  labels: A;
  errors: Record<string, string>;
}) {
  const [state, setState] = useState<'working' | 'ok' | 'fail'>('working');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void callApi('POST', '/api/v1/auth/verify-email', { token }).then((out) => {
      setState(out.ok ? 'ok' : 'fail');
      void errors;
    });
  }, [token, errors]);
  if (state === 'working') return <p className="muted">…</p>;
  if (state === 'fail') return <Alert kind="error">{labels.verifyFailed}</Alert>;
  return (
    <div className="stack">
      <Alert kind="success">{labels.verifyDone}</Alert>
      <Link className="btn block" href={`/${locale}/app`}>
        {labels.continue}
      </Link>
    </div>
  );
}
