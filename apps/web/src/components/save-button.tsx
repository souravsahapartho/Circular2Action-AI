'use client';

import Link from 'next/link';
import { useState } from 'react';
import { callApi } from '@/lib/client-api';
import { Icon } from './ui';

/** Bookmark toggle. Signed-out visitors are sent to sign in and back. */
export function SaveButton({
  opportunityId,
  initialSaved,
  signedIn,
  locale,
  nextPath,
  labels,
  variant = 'icon',
}: {
  opportunityId: string;
  initialSaved: boolean;
  signedIn: boolean;
  locale: string;
  nextPath: string;
  labels: { save: string; saved: string; signIn: string };
  variant?: 'icon' | 'button';
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  if (!signedIn) {
    const href = `/${locale}/sign-in?next=${encodeURIComponent(nextPath)}`;
    return variant === 'icon' ? (
      <Link className="save-btn" href={href} aria-label={labels.signIn} title={labels.signIn}>
        <Icon name="bookmark" />
      </Link>
    ) : (
      <Link className="btn secondary block" href={href}>
        <Icon name="bookmark" /> {labels.signIn}
      </Link>
    );
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !saved;
    setSaved(next); // optimistic
    const out = await callApi(next ? 'PUT' : 'DELETE', `/api/v1/me/saved/${opportunityId}`);
    if (!out.ok) setSaved(!next);
    setBusy(false);
  }

  return variant === 'icon' ? (
    <button
      type="button"
      className="save-btn"
      aria-pressed={saved}
      aria-label={saved ? labels.saved : labels.save}
      title={saved ? labels.saved : labels.save}
      onClick={() => void toggle()}
    >
      <Icon name="bookmark" />
    </button>
  ) : (
    <button
      type="button"
      className="btn secondary block"
      aria-pressed={saved}
      onClick={() => void toggle()}
    >
      <Icon name="bookmark" /> {saved ? labels.saved : labels.save}
    </button>
  );
}
