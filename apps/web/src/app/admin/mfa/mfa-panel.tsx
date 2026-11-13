'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'That code is not correct. Check the time on your phone and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes.',
};

export function MfaPanel({ enrolled, email }: { enrolled: boolean; email: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (enrolled || secret) return;
    void callApi<{ secret: string; otpauth_uri: string }>('POST', '/api/v1/auth/mfa/enroll').then(
      async (out) => {
        if (out.ok && out.data) {
          setSecret(out.data.secret);
          setQr(await QRCode.toDataURL(out.data.otpauth_uri, { margin: 1, width: 192 }));
        } else setError('Could not start setup. Please reload the page.');
      },
    );
  }, [enrolled, secret]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const v = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    const out = enrolled
      ? await callApi(
          'POST',
          '/api/v1/auth/mfa/verify',
          recovery ? { recovery_code: v } : { code: v },
        )
      : await callApi<{ recovery_codes: string[] }>('POST', '/api/v1/auth/mfa/confirm', {
          code: v,
        });
    setBusy(false);
    if (!out.ok) {
      setError(MESSAGES[out.error?.code ?? ''] ?? 'Something went wrong. Please try again.');
      return;
    }
    if (!enrolled && out.data && 'recovery_codes' in (out.data as object)) {
      setCodes((out.data as { recovery_codes: string[] }).recovery_codes);
    } else window.location.assign('/admin');
  }

  if (codes) {
    return (
      <div className="stack">
        <Alert kind="warn">
          Save these recovery codes now. Each works once if you lose your phone. They are shown only
          this one time.
        </Alert>
        <div className="codes" aria-label="Recovery codes">
          {codes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="row-flex">
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              const blob = new Blob(
                [`Circular2Action recovery codes for ${email}\n\n${codes.join('\n')}\n`],
                { type: 'text/plain' },
              );
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'c2a-recovery-codes.txt';
              a.click();
            }}
          >
            Download
          </button>
          <button className="btn" type="button" onClick={() => window.location.assign('/admin')}>
            I have saved them, continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {!enrolled && secret ? (
        <>
          <div className="row-flex" style={{ alignItems: 'flex-start' }}>
            {qr ? (
              <img src={qr} alt="QR code for your authenticator app" width={192} height={192} />
            ) : null}
            <div>
              <p className="small muted" style={{ margin: 0 }}>
                Or enter this key manually:
              </p>
              <p className="mono" style={{ wordBreak: 'break-all', margin: '4px 0 0' }}>
                {secret}
              </p>
            </div>
          </div>
        </>
      ) : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <form onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="code">{recovery ? 'Recovery code' : '6-digit code'}</label>
          <input
            id="code"
            name="code"
            className="input mono"
            inputMode={recovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            required
            maxLength={recovery ? 20 : 6}
            pattern={recovery ? undefined : '\\d{6}'}
            autoFocus
          />
        </div>
        <button className="btn block" type="submit" disabled={busy || (!enrolled && !secret)}>
          {enrolled ? 'Verify' : 'Confirm and finish setup'}
        </button>
      </form>
      {enrolled ? (
        <button className="btn ghost" type="button" onClick={() => setRecovery((v) => !v)}>
          {recovery ? 'Use my authenticator app' : 'Use a recovery code instead'}
        </button>
      ) : null}
    </div>
  );
}
