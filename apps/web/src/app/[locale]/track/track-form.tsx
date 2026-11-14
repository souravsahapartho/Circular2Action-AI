'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';

/** Accepts what people type (lower case, spaces, missing dashes) and goes to the canonical tracking page. */
function canonical(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('C2A') ? raw.slice(3) : raw;
  if (body.length !== 8) return null;
  return `C2A-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function TrackForm({
  locale,
  labels,
  initial = '',
  error,
}: {
  locale: string;
  labels: Dictionary['track'];
  initial?: string;
  error?: string | undefined;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [bad, setBad] = useState(false);
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        const code = canonical(value);
        if (!code) {
          setBad(true);
          return;
        }
        router.push(`/${locale}/track/${code}`);
      }}
    >
      <div className={`field${bad || error ? ' invalid' : ''}`}>
        <label htmlFor="tk-code">{labels.title}</label>
        <input
          id="tk-code"
          className="input tracking-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setBad(false);
          }}
          placeholder={labels.placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
        />
        <span className="muted small">{labels.example}</span>
        {bad || error ? <span className="field-error">{error ?? labels.notFound}</span> : null}
      </div>
      <button className="btn" type="submit">
        {labels.button}
      </button>
    </form>
  );
}
