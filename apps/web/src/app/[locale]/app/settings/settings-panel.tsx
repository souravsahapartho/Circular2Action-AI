'use client';

import { useState } from 'react';
import { Alert, Icon } from '@/components/ui';
import { formatDate } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { t } from '@/i18n/dictionaries';
import { callApi, errorMessage } from '@/lib/client-api';

export interface SessionInfo {
  id: string;
  user_agent: string | null;
  last_seen_at: string;
  current: boolean;
}
type L = Dictionary['settings'];

const CONSENT_KEYS = ['weekly_digest', 'analytics'] as const;

function Msg({ ok, text }: { ok: boolean | null; text: string | null }) {
  if (!text) return null;
  return <Alert kind={ok ? 'success' : 'error'}>{text}</Alert>;
}

export function SettingsPanel({
  locale,
  me,
  consents,
  sessions: initialSessions,
  graceEndsAt,
  labels,
  errors,
  auth,
}: {
  locale: 'bn' | 'en';
  me: { name: string; email: string; locale: 'bn' | 'en'; pendingDeletion: boolean };
  consents: Record<string, boolean> | null;
  sessions: SessionInfo[];
  graceEndsAt: string | null;
  labels: L;
  errors: Record<string, string>;
  auth: Dictionary['auth'];
}) {
  const [name, setName] = useState(me.name);
  const [lang, setLang] = useState(me.locale);
  const [acct, setAcct] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState<{ ok: boolean; text: string } | null>(null);
  const [sessions, setSessions] = useState(initialSessions);
  const [consent, setConsent] = useState(consents ?? {});
  const [del, setDel] = useState<{ ok: boolean; text: string } | null>(null);

  if (me.pendingDeletion) {
    return (
      <div className="card stack">
        <h2>{labels.danger}</h2>
        <Alert kind="warn">
          {graceEndsAt
            ? t(labels.deletePending, { date: formatDate(graceEndsAt, locale) })
            : labels.deletedNotice}
        </Alert>
        <button
          className="btn"
          type="button"
          onClick={async () => {
            const out = await callApi('POST', '/api/v1/me/delete/cancel');
            if (out.ok) window.location.assign(`/${locale}/app`);
            else setDel({ ok: false, text: errorMessage(errors, out) });
          }}
        >
          {labels.cancelDeletion}
        </button>
        <Msg ok={del?.ok ?? null} text={del?.text ?? null} />
      </div>
    );
  }

  return (
    <div className="stack">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setAcct(null);
          const out = await callApi('PATCH', '/api/v1/me', {
            display_name: name.trim(),
            locale: lang,
          });
          setAcct(
            out.ok
              ? { ok: true, text: labels.saved }
              : { ok: false, text: errorMessage(errors, out) },
          );
        }}
      >
        <h2>{labels.account}</h2>
        <Msg ok={acct?.ok ?? null} text={acct?.text ?? null} />
        <p className="muted small">{me.email}</p>
        <div className="form-grid two">
          <div className="field">
            <label htmlFor="s-name">{labels.name}</label>
            <input
              id="s-name"
              className="input"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="s-lang">{labels.language}</label>
            <select
              id="s-lang"
              className="input"
              value={lang}
              onChange={(e) => setLang(e.target.value as 'bn' | 'en')}
            >
              <option value="bn">বাংলা</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        <button className="btn" type="submit">
          {labels.save}
        </button>
      </form>

      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setPw(null);
          const f = new FormData(e.currentTarget);
          const out = await callApi('POST', '/api/v1/auth/password/change', {
            current_password: String(f.get('current') ?? ''),
            new_password: String(f.get('next') ?? ''),
          });
          if (out.ok) {
            setPw({ ok: true, text: labels.changed });
            (e.target as HTMLFormElement).reset();
          } else setPw({ ok: false, text: errorMessage(errors, out) });
        }}
      >
        <h2>{labels.passwordTitle}</h2>
        <Msg ok={pw?.ok ?? null} text={pw?.text ?? null} />
        <div className="form-grid two">
          <div className="field">
            <label htmlFor="s-cur">{labels.current}</label>
            <input
              id="s-cur"
              name="current"
              type="password"
              autoComplete="current-password"
              required
              className="input"
            />
          </div>
          <div className="field">
            <label htmlFor="s-new">{labels.new}</label>
            <input
              id="s-new"
              name="next"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="input"
            />
            <span className="hint">{auth.passwordHint}</span>
          </div>
        </div>
        <button className="btn" type="submit">
          {labels.change}
        </button>
      </form>

      <section className="card">
        <h2>{labels.sessions}</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {sessions.map((s) => (
            <li
              key={s.id}
              className="rule-row"
              style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}
            >
              <div>
                <strong>
                  {s.current ? labels.thisDevice : (s.user_agent ?? '—').slice(0, 60)}
                </strong>
                <div className="muted small">
                  {labels.lastSeen}:{' '}
                  <time dateTime={s.last_seen_at}>{formatDate(s.last_seen_at, locale)}</time>
                </div>
              </div>
              {s.current ? null : (
                <button
                  className="btn secondary sm"
                  type="button"
                  onClick={async () => {
                    const out = await callApi('DELETE', `/api/v1/auth/sessions/${s.id}`);
                    if (out.ok) setSessions((p) => p.filter((x) => x.id !== s.id));
                  }}
                >
                  <Icon name="logout" size="sm" /> {labels.revoke}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {consents ? (
        <section className="card">
          <h2>{labels.consents}</h2>
          <p className="muted small">{labels.required}</p>
          <div className="stack">
            {CONSENT_KEYS.map((k) => (
              <label key={k} className="check">
                <input
                  type="checkbox"
                  checked={consent[k] === true}
                  onChange={async (e) => {
                    const granted = e.target.checked;
                    setConsent((p) => ({ ...p, [k]: granted }));
                    const out = await callApi('POST', '/api/v1/me/consents', {
                      purpose: k,
                      granted,
                      policy_version: '2026-11-draft',
                    });
                    if (!out.ok) setConsent((p) => ({ ...p, [k]: !granted }));
                  }}
                />
                <span>{(labels as unknown as Record<string, string>)[`c_${k}`]}</span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <form
        className="card"
        style={{ borderColor: 'var(--danger-700)' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setDel(null);
          const f = new FormData(e.currentTarget);
          const out = await callApi('POST', '/api/v1/me/delete', {
            password: String(f.get('password') ?? ''),
            confirm_email: String(f.get('email') ?? ''),
          });
          if (out.ok) window.location.assign(`/${locale}/sign-in`);
          else setDel({ ok: false, text: errorMessage(errors, out) });
        }}
      >
        <h2 style={{ color: 'var(--danger-700)' }}>{labels.danger}</h2>
        <p>{labels.deleteText}</p>
        <Msg ok={del?.ok ?? null} text={del?.text ?? null} />
        <div className="form-grid two">
          <div className="field">
            <label htmlFor="d-email">{labels.confirmEmail}</label>
            <input
              id="d-email"
              name="email"
              type="email"
              required
              className="input"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="d-pw">{auth.password}</label>
            <input
              id="d-pw"
              name="password"
              type="password"
              required
              className="input"
              autoComplete="current-password"
            />
          </div>
        </div>
        <button className="btn danger" type="submit">
          {labels.deleteButton}
        </button>
      </form>
    </div>
  );
}
