'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import type { Dictionary } from '@/i18n/dictionaries';
import { t } from '@/i18n/dictionaries';
import { callApi, errorMessage } from '@/lib/client-api';

export interface Prefs {
  categories: string[];
  keywords: string[];
  location_slugs: string[];
  alerts_enabled: boolean;
  personalize: boolean;
}

export function InterestsForm({
  initial,
  activityCount,
  categories,
  locations,
  labels,
  errors,
}: {
  initial: Prefs;
  activityCount: number;
  categories: Array<{ slug: string; name: string }>;
  locations: Array<{ slug: string; name: string }>;
  labels: Dictionary['interests'];
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [p, setP] = useState<Prefs>({
    categories: initial.categories,
    keywords: initial.keywords,
    location_slugs: initial.location_slugs,
    alerts_enabled: initial.alerts_enabled,
    personalize: initial.personalize,
  });
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(activityCount);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (key: 'categories' | 'location_slugs', slug: string) =>
    setP((prev) => ({
      ...prev,
      [key]: prev[key].includes(slug) ? prev[key].filter((s) => s !== slug) : [...prev[key], slug],
    }));

  const addWord = () => {
    const w = word.trim().toLowerCase();
    if (w.length >= 2 && !p.keywords.includes(w) && p.keywords.length < 15) {
      setP((prev) => ({ ...prev, keywords: [...prev.keywords, w] }));
    }
    setWord('');
  };

  async function save() {
    setBusy(true);
    setMsg(null);
    // only the fields the API accepts (the GET response also carries the activity count)
    const out = await callApi('PUT', '/api/v1/me/preferences', {
      categories: p.categories,
      keywords: p.keywords,
      location_slugs: p.location_slugs,
      alerts_enabled: p.alerts_enabled,
      personalize: p.personalize,
    });
    setBusy(false);
    if (out.ok) {
      setMsg({ ok: true, text: labels.saved });
      router.refresh();
    } else setMsg({ ok: false, text: errorMessage(errors, out) });
  }

  async function clear() {
    if (!window.confirm(labels.clearConfirm)) return;
    const out = await callApi('DELETE', '/api/v1/me/activity');
    if (out.ok) {
      setCount(0);
      setMsg({ ok: true, text: labels.cleared });
      router.refresh();
    } else setMsg({ ok: false, text: errorMessage(errors, out) });
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.0625rem' }}>{labels.categories}</h2>
        <div className="chip-picker">
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              className="pick"
              aria-pressed={p.categories.includes(c.slug)}
              onClick={() => toggle('categories', c.slug)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.0625rem' }}>{labels.keywords}</h2>
        <p className="muted small">{labels.keywordsHint}</p>
        <div className="chip-picker" style={{ marginBottom: 10 }}>
          {p.keywords.map((k) => (
            <button
              key={k}
              type="button"
              className="pick"
              aria-pressed="true"
              title={labels.remove}
              onClick={() =>
                setP((prev) => ({ ...prev, keywords: prev.keywords.filter((x) => x !== k) }))
              }
            >
              {k} ×
            </button>
          ))}
        </div>
        <div className="row-flex">
          <label htmlFor="kw" className="sr-only">
            {labels.keywords}
          </label>
          <input
            id="kw"
            className="input"
            style={{ maxWidth: 320 }}
            value={word}
            maxLength={40}
            placeholder={labels.keywordPlaceholder}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addWord();
              }
            }}
          />
          <button type="button" className="btn secondary" onClick={addWord}>
            +
          </button>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.0625rem' }}>{labels.places}</h2>
        <p className="muted small">{labels.placesHint}</p>
        <div className="chip-picker">
          {locations.map((l) => (
            <button
              key={l.slug}
              type="button"
              className="pick"
              aria-pressed={p.location_slugs.includes(l.slug)}
              onClick={() => toggle('location_slugs', l.slug)}
            >
              {l.name}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack">
        <label className="switch">
          <input
            type="checkbox"
            checked={p.alerts_enabled}
            onChange={(e) => setP((prev) => ({ ...prev, alerts_enabled: e.target.checked }))}
          />
          <span>
            <strong>{labels.alerts}</strong>
            <span className="muted small" style={{ display: 'block' }}>
              {labels.alertsHint}
            </span>
          </span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={p.personalize}
            onChange={(e) => setP((prev) => ({ ...prev, personalize: e.target.checked }))}
          />
          <span>
            <strong>{labels.personalize}</strong>
            <span className="muted small" style={{ display: 'block' }}>
              {labels.personalizeHint}
            </span>
          </span>
        </label>
      </section>

      <div className="row-flex">
        <button className="btn" type="submit" disabled={busy}>
          {labels.save}
        </button>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.0625rem' }}>{labels.activityTitle}</h2>
        <p className="muted">{t(labels.activityText, { n: String(count) })}</p>
        <button
          type="button"
          className="btn danger"
          disabled={count === 0}
          onClick={() => void clear()}
        >
          {labels.clear}
        </button>
      </section>
    </form>
  );
}
